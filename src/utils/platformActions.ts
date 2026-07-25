/**
 * Shared handlers for MangaPage actions across all 5 platforms.
 * Previously duplicated in each platform page.
 *
 * All platform-specific bits go through the registry (getAPI), signal, and store.
 * No `this` — pure functions driven by current store state.
 */
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { getAPI } from '@/src/api';
import { nodeStore, withBatch } from '@/src/utils/nodeStorage';
import { autoResolveMissing } from '@/src/utils/transitiveResolve';
import { Logger } from '@/src/utils/logger';
import type { PlatformKey } from '@/src/types';

export interface PlatformActionOpts {
  onLoaded?: (platformKey: PlatformKey) => void;
  loggerContext?: string;
}

/** Load (or search) data for a single target platform. */
export async function loadPlatformData(
  currentPlatform: PlatformKey,
  platformKey: PlatformKey,
  signal: AbortSignal,
  opts: PlatformActionOpts = {}
): Promise<void> {
  if (signal.aborted) return;

  const loggerContext = opts.loggerContext ?? 'PlatformActions';
  const store = useMappingsStore.getState();
  const api = getAPI(platformKey);

  try {
    const { manualLinks, autoLinks, disabled } = store;

    if (disabled[platformKey]) return;

    const existingSlug = manualLinks[platformKey] ?? autoLinks[platformKey];

    if (typeof existingSlug === 'string') {
      // F2.2: one loadCachedResult call — fetch fresh data first if cache miss, then load once
      const cached = await store.loadCachedResult(platformKey);
      if (!cached && api.getData) {
        await api.getData?.(existingSlug);
        await store.loadCachedResult(platformKey);
      }
      opts.onLoaded?.(platformKey);
      return;
    }

    if (existingSlug === false) return;

    const { titles } = useMangaStore.getState();
    if (titles.length === 0) return;

    store.setLoading(platformKey, true);
    const result = await api.search(
      currentPlatform,
      store.currentSlug || '',
      titles,
      signal
    );
    store.setLoading(platformKey, false);

    if (result) {
      await store.saveAutoMapping(platformKey, result.slug);
      if (api.getData) {
        await api.getData?.(result.slug);
      }
      await store.loadCachedResult(platformKey);
      opts.onLoaded?.(platformKey);

      const node = await nodeStore.resolveByTuple(
        currentPlatform,
        store.currentSlug || ''
      );
      if (node) {
        autoResolveMissing(node, signal)
          .then(() => store.refreshFromNode())
          .catch((err) => Logger.warn(loggerContext, 'transitive resolve failed', err));
      }
    } else {
      await store.saveAutoMapping(platformKey, false);
    }
  } catch (error) {
    store.setLoading(platformKey, false);
    Logger.error(loggerContext, `Error loading ${platformKey}`, error);
  }
}

/**
 * Refresh: re-fetch data for a manual link, or re-run the search for an auto one.
 *
 * Auto slugs get dropped before reloading: refreshing only the cache would keep
 * re-fetching the same slug forever, so a wrong auto match could never fix
 * itself. Manual links are the user's explicit choice and are never re-searched.
 */
export async function handleRefresh(
  currentPlatform: PlatformKey,
  platformKey: PlatformKey,
  signal: AbortSignal,
  opts: PlatformActionOpts = {}
): Promise<void> {
  const store = useMappingsStore.getState();
  const { manualLinks, autoLinks, disabled } = store;
  const api = getAPI(platformKey);

  if (disabled[platformKey]) return;

  const manualSlug = manualLinks[platformKey];

  if (typeof manualSlug === 'string') {
    await store.invalidateCache(platformKey, manualSlug);
    store.setLoading(platformKey, true);
    try {
      await api.getData?.(manualSlug);
    } finally {
      store.setLoading(platformKey, false);
    }
    await store.loadCachedResult(platformKey);
    opts.onLoaded?.(platformKey);
    return;
  }

  // Manual `false` — user said "not on this platform". Leave it.
  if (manualSlug === false) return;

  const autoSlug = autoLinks[platformKey];
  if (typeof autoSlug === 'string') {
    await store.invalidateCache(platformKey, autoSlug);
  }
  if (autoSlug !== undefined) {
    await store.deleteAutoMapping(platformKey);
  }

  await loadPlatformData(currentPlatform, platformKey, signal, opts);
}

/** Save a manual link (URL) or trigger delete logic if URL empty. */
export async function handleSaveLink(
  currentPlatform: PlatformKey,
  platformKey: PlatformKey,
  url: string,
  signal: AbortSignal,
  opts: PlatformActionOpts = {}
): Promise<void> {
  const api = getAPI(platformKey);
  const extractedSlug = api.getSlugFromURL(url);
  if (!extractedSlug) {
    Logger.warn(opts.loggerContext ?? 'PlatformActions', `Invalid URL for ${platformKey}: ${url}`);
    return;
  }

  const store = useMappingsStore.getState();
  await store.saveManualLink(platformKey, extractedSlug);
  await store.invalidateCache(platformKey, extractedSlug);
  await loadPlatformData(currentPlatform, platformKey, signal, opts);
}

/** Delete mapping (manual+auto) AND reset offsets/disabled for this platform. */
export async function handleDeleteLink(
  currentPlatform: PlatformKey,
  platformKey: PlatformKey,
  signal: AbortSignal,
  opts: PlatformActionOpts = {}
): Promise<void> {
  const store = useMappingsStore.getState();
  const currentSlug = store.manualLinks[platformKey] ?? store.autoLinks[platformKey];
  const { nodeId } = useMappingsStore.getState();

  if (nodeId) {
    await nodeStore.resetPlatformSlot(nodeId, platformKey);
    await store.refreshFromNode();
  }

  if (typeof currentSlug === 'string') {
    await store.invalidateCache(platformKey, currentSlug);
  }

  await loadPlatformData(currentPlatform, platformKey, signal, opts);
}

/**
 * Load data for all other platforms in parallel (fire-and-forget).
 * R2.4: wraps the fan-out in `withBatch` so all auto-mapping writes across platforms
 * collapse into one storage.local.set at the end instead of N sequential ones.
 */
export function loadAllPlatformsData(
  currentPlatform: PlatformKey,
  otherPlatforms: Iterable<PlatformKey>,
  signal: AbortSignal,
  opts: PlatformActionOpts = {}
): void {
  const platforms = Array.from(otherPlatforms);
  void withBatch(async () => {
    await Promise.all(
      platforms.map((platformKey) => {
        if (signal.aborted) return Promise.resolve();
        return loadPlatformData(currentPlatform, platformKey, signal, opts);
      })
    );
  }).catch((err) =>
    Logger.error(opts.loggerContext ?? 'PlatformActions', 'loadAllPlatformsData failed', err)
  );
}
