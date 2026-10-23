/**
 * Transitive resolve: a target missed by the current page's titles can still be
 * found through another linked platform's names — e.g. Senkuro's alt names hit
 * a site that MangaLib's titles missed.
 *
 * Only titles the direct search hasn't tried are searched: bridge names mostly
 * repeat the current page's, and re-searching them cost dozens of requests.
 * Writing "not found" stays with the caller; `failed` lists targets whose
 * absence couldn't be confirmed because a request failed.
 */
import { Logger } from './logger';
import { addOrMergeSlug } from './nodeStorage';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { collectTitles, uniqueTitles } from './manga';
import { safeEntries } from './platformKeys';
import type { TitleProfile } from './matchScore';
import type { MangaNode, MappingValue, PlatformKey } from '@/src/types';

export async function resolveViaBridges(
  node: MangaNode,
  targets: readonly PlatformKey[],
  skipBridge: PlatformKey,
  triedTitles: ReadonlySet<string>,
  page: TitleProfile | null,
  signal?: AbortSignal
): Promise<{ resolved: Set<PlatformKey>; failed: Set<PlatformKey> }> {
  const resolved = new Set<PlatformKey>();
  const failed = new Set<PlatformKey>();

  const bridges: Array<{ platform: PlatformKey; slug: string; titles: string[] }> = [];
  await Promise.all(
    Array.from(safeEntries<MappingValue>(node.slugs), async ([platform, slug]) => {
      // A target can't bridge to itself: on refresh its old (possibly wrong)
      // link is still in the node and would simply find itself again.
      if (typeof slug !== 'string' || platform === skipBridge || targets.includes(platform)) return;
      try {
        const names = collectTitles(await PlatformRegistry.get(platform)?.getManga(slug));
        const titles = uniqueTitles(names, triedTitles);
        if (titles.length > 0) bridges.push({ platform, slug, titles });
      } catch (err) {
        Logger.warn('transitiveResolve', `Bridge ${platform} getManga failed`, err);
      }
    })
  );

  for (const target of targets) {
    const targetAPI = PlatformRegistry.get(target);
    if (!targetAPI) continue;

    for (const bridge of bridges) {
      if (signal?.aborted) return { resolved, failed };
      try {
        // Scored against the page's title: a wrong bridge must not vouch for its own namesakes.
        const result = await targetAPI.searchVerified(bridge.titles, page, signal);
        if (signal?.aborted) return { resolved, failed };
        if (result === undefined) {
          failed.add(target);
          continue;
        }
        if (!result) continue;

        await addOrMergeSlug(bridge.platform, bridge.slug, target, result.slug, 'auto');
        resolved.add(target);
        failed.delete(target);
        break;
      } catch (err) {
        failed.add(target);
        Logger.warn('transitiveResolve', `Search ${bridge.platform}→${target} failed`, err);
      }
    }
  }

  return { resolved, failed };
}
