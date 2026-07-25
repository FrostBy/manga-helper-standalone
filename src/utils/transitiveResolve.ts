/**
 * Transitive auto-resolve: if a node has slug on platform A, use A's metadata
 * (titles) to search on any target platform B that's still missing.
 *
 * Example: inkstory dictionary knows mangalib, mangalib knows senkuro. Via
 * mangalib titles we find senkuro even when inkstory↔senkuro has no direct
 * dictionary overlap.
 *
 * Depth=1: this function does NOT recurse into itself. A new pass runs on the
 * next user action / refresh. This prevents runaway fan-out.
 */
import { Logger } from './logger';
import { addOrMergeSlug, AUTO_FALSE_TTL, nodeStore, withBatch } from './nodeStorage';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { collectTitles } from './manga';
import { safeEntries } from './platformKeys';
import type { MangaNode, MappingValue, PlatformKey } from '@/src/types';

export async function autoResolveMissing(
  node: MangaNode,
  signal?: AbortSignal
): Promise<void> {
  const now = Date.now();
  const allTargets = PlatformRegistry.getKeys();
  // R3.1: safeEntries validates keys against PlatformRegistry whitelist.
  const bridges: PlatformKey[] = [];
  for (const [p, v] of safeEntries<MappingValue>(node.slugs)) {
    if (typeof v === 'string') bridges.push(p);
  }

  if (bridges.length === 0) return;

  // F2.5: prefetch bridge metadata (titles) in parallel — reused across all targets
  const bridgeTitles = new Map<PlatformKey, string[]>();
  await Promise.all(
    bridges.map(async (bridge) => {
      if (signal?.aborted) return;
      const bridgeAPI = PlatformRegistry.get(bridge);
      const bridgeSlug = node.slugs[bridge];
      if (!bridgeAPI || typeof bridgeSlug !== 'string') return;
      try {
        const manga = await bridgeAPI.getManga(bridgeSlug);
        if (!manga) return;
        const titles = collectTitles(manga);
        if (titles.length > 0) bridgeTitles.set(bridge, titles);
      } catch (err) {
        Logger.warn('transitiveResolve', `Bridge ${bridge} getManga failed`, err);
      }
    })
  );

  if (signal?.aborted) return;

  // For each missing target, try bridges until one hits
  const negativeTargets: PlatformKey[] = [];
  for (const target of allTargets) {
    if (signal?.aborted) return;
    if (typeof node.slugs[target] === 'string') continue;
    if (node.disabled[target]) continue;
    if (node.slugs[target] === false && (node.expires[target] ?? 0) > now) continue;
    if (node.source[target] === 'manual') continue;

    const targetAPI = PlatformRegistry.get(target);
    if (!targetAPI) continue;

    let found = false;
    // R5.2: only write negative cache if at least one bridge's search actually returned
    // (null = "really no match"). Network/API errors do NOT count — we want to retry later.
    let hadSuccessfulProbe = false;
    for (const bridge of bridges) {
      if (signal?.aborted) return;
      if (bridge === target) continue;
      const titles = bridgeTitles.get(bridge);
      if (!titles) continue;
      const bridgeSlug = node.slugs[bridge];
      if (typeof bridgeSlug !== 'string') continue;

      try {
        const result = await targetAPI.search(bridge, bridgeSlug, titles, signal);
        hadSuccessfulProbe = true;
        if (result) {
          await addOrMergeSlug(bridge, bridgeSlug, target, result.slug, 'auto');
          found = true;
          Logger.debug('transitiveResolve', `Resolved ${target} via bridge ${bridge}`, {
            nodeId: node.id,
            slug: result.slug,
          });
          break;
        }
      } catch (err) {
        Logger.warn('transitiveResolve', `Search ${bridge}→${target} failed`, err);
      }
    }

    if (!found && hadSuccessfulProbe) negativeTargets.push(target);
  }

  // Batch-write all negative caches at the end.
  // R1.2: re-check each slot against the FRESH node inside the updater — user may have
  // saved a manual slug during the slow bridge prefetch.
  if (negativeTargets.length > 0 && !signal?.aborted) {
    const writeTs = Date.now();
    await withBatch(async () => {
      await nodeStore.updateNode(node.id, (n) => {
        for (const target of negativeTargets) {
          if (n.source[target] === 'manual') continue;
          if (n.disabled[target]) continue;
          if (typeof n.slugs[target] === 'string') continue;
          n.slugs[target] = false;
          n.expires[target] = writeTs + AUTO_FALSE_TTL;
          n.source[target] = 'auto';
        }
      });
    });
    Logger.debug('transitiveResolve', `Wrote negative cache`, { count: negativeTargets.length });
  }
}
