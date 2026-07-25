/**
 * LRU cleanup for chrome.storage.local.
 *
 * Triggers:
 * - Periodic via chrome.alarms('storageCleanup', periodInMinutes=1440)
 * - Reactive when getBytesInUse() > 80% of limit
 *
 * Target after cleanup: 60% of limit.
 *
 * Removal order (safest first):
 *  1. Expired cache entries
 *  2. Cache entries by expires asc
 *  3. Expired negative auto-mappings inside nodes (slugs[t]=false with dead TTL)
 *  4. Auto-only nodes by lastAccessedAt asc
 *  5. User-data nodes older than grace period (365d)
 *  6. Stop
 *
 * Grace period: user-data nodes within 365 days of lastAccessedAt are protected.
 */
import { Logger } from './logger';
import { cache } from './storage';
import { nodeStore, withBatch } from './nodeStorage';
import { safeEntries } from './platformKeys';
import type { MangaNode, MappingValue } from '@/src/types';

export const USER_DATA_GRACE_MS = 365 * 24 * 60 * 60 * 1000;
const LOCAL_QUOTA_BYTES = 10 * 1024 * 1024; // Chrome/Firefox MV3 default
const TRIGGER_RATIO = 0.80;
const TARGET_RATIO = 0.60;

/** Approximate bytes in use of chrome.storage.local via typed WXT browser API. */
export async function estimateSize(): Promise<number> {
  try {
    const bytes = await browser.storage.local.getBytesInUse();
    return bytes ?? 0;
  } catch (err) {
    Logger.warn('storageCleanup', 'getBytesInUse failed', err);
    return 0;
  }
}

function hasUserData(node: MangaNode): boolean {
  if (Object.keys(node.disabled).length > 0) return true;
  if (Object.values(node.offsets).some((v) => typeof v === 'number' && v !== 0)) return true;
  if (Object.values(node.source).some((v) => v === 'manual')) return true;
  return false;
}

/**
 * Run cleanup until size ≤ targetBytes or no more safe deletions possible.
 * Returns list of actions taken (for logging/verification).
 */
export async function runCleanup(forceFull: boolean = false): Promise<{
  before: number;
  after: number;
  removedCacheEntries: number;
  removedNodes: number;
}> {
  const before = await estimateSize();
  const triggerBytes = LOCAL_QUOTA_BYTES * TRIGGER_RATIO;
  const targetBytes = LOCAL_QUOTA_BYTES * TARGET_RATIO;

  if (!forceFull && before < triggerBytes) {
    return { before, after: before, removedCacheEntries: 0, removedNodes: 0 };
  }

  Logger.info('storageCleanup', 'Starting cleanup', { before, targetBytes });

  let removedCacheEntries = 0;
  let removedNodes = 0;
  const now = Date.now();

  // Step 1+2: expired cache, then cache by expires asc
  const cacheAll = await cache.getAll();
  const cacheEntries: Array<{ target: string; slug: string; expires: number }> = [];
  for (const [target, bySlug] of Object.entries(cacheAll)) {
    for (const [slug, entry] of Object.entries(bySlug)) {
      cacheEntries.push({ target, slug, expires: entry.expires });
    }
  }
  cacheEntries.sort((a, b) => a.expires - b.expires);

  // R2.2 + R2.5: batch-delete in chunks of 50 (one write per chunk). Re-check size
  // only every 5 chunks so cleanup doesn't stall on getBytesInUse calls.
  const CACHE_CHUNK = 50;
  const SIZE_CHECK_EVERY = 5;
  for (let i = 0; i < cacheEntries.length; i += CACHE_CHUNK) {
    const chunk = cacheEntries.slice(i, i + CACHE_CHUNK);
    await cache.deleteMany(chunk);
    removedCacheEntries += chunk.length;
    const chunkIdx = i / CACHE_CHUNK;
    if (chunkIdx % SIZE_CHECK_EVERY === SIZE_CHECK_EVERY - 1) {
      if ((await estimateSize()) <= targetBytes && !forceFull) break;
    }
  }

  // F1.5 + F2.3: Steps 3-5 run in one batch with size re-check only between chunks (50)
  const CHUNK = 50;

  await withBatch(async () => {
    // Step 3: prune dead negative-cache entries inside nodes.
    // R5.1: only touch auto-sourced slots — manual=false means "user-disabled" and must survive cleanup.
    const nodes = await nodeStore.getAll();
    for (const node of Object.values(nodes)) {
      for (const [p, slug] of safeEntries<MappingValue>(node.slugs)) {
        if (slug !== false) continue;
        if (node.source[p] !== 'auto') continue;
        if ((node.expires[p] ?? 0) >= now) continue;
        delete node.slugs[p];
        delete node.expires[p];
        delete node.source[p];
      }
    }
  });

  if ((await estimateSize()) <= targetBytes && !forceFull) {
    const after = await estimateSize();
    return { before, after, removedCacheEntries, removedNodes };
  }

  // Step 4+5: node deletion (auto-only first, then old user-data) in batch
  const refreshedNodes = await nodeStore.getAll();
  const nodeList = Object.values(refreshedNodes);

  const autoOnly = nodeList.filter((n) => !hasUserData(n));
  const userDataOld = nodeList.filter(
    (n) => hasUserData(n) && n.lastAccessedAt < now - USER_DATA_GRACE_MS
  );

  autoOnly.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
  userDataOld.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

  const victims = [...autoOnly, ...userDataOld];
  for (let i = 0; i < victims.length; i += CHUNK) {
    const chunk = victims.slice(i, i + CHUNK);
    await withBatch(async () => {
      for (const node of chunk) {
        await nodeStore.deleteNode(node.id);
        removedNodes++;
      }
    });
    if ((await estimateSize()) <= targetBytes) break;
  }

  const after = await estimateSize();
  Logger.info('storageCleanup', 'Cleanup done', { before, after, removedCacheEntries, removedNodes });
  return { before, after, removedCacheEntries, removedNodes };
}

/** Hook for background worker to set up periodic cleanup via browser.alarms. */
export function registerCleanupAlarm(): void {
  try {
    browser.alarms.create('storageCleanup', { periodInMinutes: 1440 });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'storageCleanup') {
        runCleanup().catch((err) => Logger.error('storageCleanup', 'alarm run failed', err));
      }
    });
  } catch (err) {
    Logger.warn('storageCleanup', 'registerCleanupAlarm failed', err);
  }
}
