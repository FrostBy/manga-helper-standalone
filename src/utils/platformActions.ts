/**
 * Shared handlers for MangaPage actions across all platforms.
 *
 * All platform-specific bits go through the registry (getAPI), signal, and store.
 */
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { getAPI } from '@/src/api';
import { nodeStore } from '@/src/utils/nodeStorage';
import { cache } from '@/src/utils/storage';
import { resolveViaBridges } from '@/src/utils/transitiveResolve';
import { normalizeTitle, uniqueTitles } from '@/src/utils/manga';
import { Logger } from '@/src/utils/logger';
import type { PlatformKey } from '@/src/types';

export interface PlatformActionOpts {
  loggerContext?: string;
}

/** `notFound` only for a verified empty search — a failed request must not be cached as absence. */
type LoadOutcome = 'done' | 'notFound';

function pageTitles(): string[] {
  return uniqueTitles(useMangaStore.getState().titles);
}

// Once aborted the store already describes the next page — every write after
// an await re-checks the signal, or this title's result lands on that one.

/** A failed fetch marks the row instead of leaving "0 [0]", which read as "no chapters". */
async function fetchData(platformKey: PlatformKey, slug: string, signal: AbortSignal): Promise<void> {
  const api = getAPI(platformKey);
  if (!api.getData || signal.aborted) return;

  const store = useMappingsStore.getState();
  store.setLoading(platformKey, true);
  let data: unknown;
  try {
    data = await api.getData(slug);
  } finally {
    if (!signal.aborted) store.setLoading(platformKey, false);
  }
  if (signal.aborted) return;

  store.setFailed(platformKey, !data);
  await store.loadCachedResult(platformKey);
}

async function loadPlatformData(
  currentPlatform: PlatformKey,
  platformKey: PlatformKey,
  signal: AbortSignal,
  opts: PlatformActionOpts
): Promise<LoadOutcome> {
  if (signal.aborted) return 'done';

  const store = useMappingsStore.getState();

  try {
    if (store.disabled[platformKey]) return 'done';

    const existingSlug = store.manualLinks[platformKey] ?? store.autoLinks[platformKey];

    if (typeof existingSlug === 'string') {
      if (!(await store.loadCachedResult(platformKey))) {
        await fetchData(platformKey, existingSlug, signal);
      }
      return 'done';
    }

    if (existingSlug === false) return 'done';

    return (await searchAndLink(currentPlatform, platformKey, signal)) === 'notFound' ? 'notFound' : 'done';
  } catch (error) {
    Logger.error(opts.loggerContext ?? 'PlatformActions', `Error loading ${platformKey}`, error);
    return 'done';
  }
}

type SearchOutcome = 'found' | 'notFound' | 'failed' | 'skipped';

/**
 * `previousSlug` is the auto link being re-checked by a refresh. When the match
 * differs, its numbers are dropped from view — otherwise the new link showed
 * the old title's chapters until (or, on failure, instead of) its own data.
 */
async function searchAndLink(
  currentPlatform: PlatformKey,
  platformKey: PlatformKey,
  signal: AbortSignal,
  previousSlug?: string
): Promise<SearchOutcome> {
  const titles = pageTitles();
  if (titles.length === 0 || signal.aborted) return 'skipped';

  const store = useMappingsStore.getState();
  store.setLoading(platformKey, true);
  let result;
  try {
    result = await getAPI(platformKey).searchVerified(currentPlatform, store.currentSlug || '', titles, signal);
  } finally {
    if (!signal.aborted) store.setLoading(platformKey, false);
  }
  if (signal.aborted) return 'skipped';

  store.setFailed(platformKey, result === undefined);
  if (result === undefined) return 'failed';
  if (!result) return 'notFound';

  if (previousSlug && previousSlug !== result.slug) {
    await store.invalidateCache(platformKey, previousSlug);
  }
  await store.saveAutoMapping(platformKey, result.slug);
  if (signal.aborted) return 'skipped';
  if (!(await store.loadCachedResult(platformKey))) {
    await fetchData(platformKey, result.slug, signal);
  }
  return 'found';
}

/**
 * Before caching "not found", retry through platforms that did match: a site
 * missed by this page's titles is often found by another site's names.
 */
async function settleNotFound(
  currentPlatform: PlatformKey,
  notFound: PlatformKey[],
  signal: AbortSignal
): Promise<void> {
  if (notFound.length === 0 || signal.aborted) return;

  const store = useMappingsStore.getState();
  const node = await nodeStore.resolveByTuple(currentPlatform, store.currentSlug ?? '');
  if (signal.aborted) return;

  let resolved = new Set<PlatformKey>();
  let failed = new Set<PlatformKey>();
  if (node) {
    const tried = new Set(pageTitles().map(normalizeTitle));
    notFound.forEach((key) => store.setLoading(key, true));
    try {
      ({ resolved, failed } = await resolveViaBridges(node, notFound, currentPlatform, tried, signal));
    } finally {
      if (!signal.aborted) notFound.forEach((key) => store.setLoading(key, false));
    }
  }

  for (const key of notFound) {
    if (signal.aborted) return;
    store.setFailed(key, failed.has(key));
    if (!resolved.has(key) && !failed.has(key)) await store.saveAutoMapping(key, false);
  }

  if (resolved.size === 0 || signal.aborted) return;
  await store.refreshFromNode();
  for (const key of resolved) {
    if (signal.aborted) return;
    const slug = useMappingsStore.getState().autoLinks[key];
    if (typeof slug === 'string' && !(await store.loadCachedResult(key))) {
      await fetchData(key, slug, signal);
    }
  }
}

async function loadPlatforms(
  currentPlatform: PlatformKey,
  platforms: PlatformKey[],
  signal: AbortSignal,
  opts: PlatformActionOpts
): Promise<void> {
  const outcomes = await Promise.all(
    platforms.map((key) => loadPlatformData(currentPlatform, key, signal, opts))
  );
  const notFound = platforms.filter((_, i) => outcomes[i] === 'notFound');
  await settleNotFound(currentPlatform, notFound, signal);
}

/**
 * Refresh re-checks an auto link so a wrong match can heal: a different match
 * replaces it, and a confirmed miss (after retrying through other sites'
 * titles) drops it. A failed request keeps it — treating every failure as "not
 * found" is what used to wipe working links. Manual links are never re-searched.
 */
export async function handleRefresh(
  currentPlatform: PlatformKey,
  platformKey: PlatformKey,
  signal: AbortSignal,
  opts: PlatformActionOpts = {}
): Promise<void> {
  const store = useMappingsStore.getState();
  if (store.disabled[platformKey]) return;

  // Manual `false` — user said "not on this platform". Leave it.
  const manualSlug = store.manualLinks[platformKey];
  if (manualSlug === false) return;

  // Storage only — the row keeps its old numbers until fresh ones arrive.
  if (typeof manualSlug === 'string') {
    await cache.delete(platformKey, manualSlug);
    await fetchData(platformKey, manualSlug, signal);
    return;
  }

  const autoSlug = store.autoLinks[platformKey];
  if (typeof autoSlug !== 'string') {
    if (autoSlug === false) await store.deleteAutoMapping(platformKey);
    await loadPlatforms(currentPlatform, [platformKey], signal, opts);
    return;
  }

  await cache.delete(platformKey, autoSlug);
  const outcome = await searchAndLink(currentPlatform, platformKey, signal, autoSlug);

  if (outcome === 'notFound') {
    await settleNotFound(currentPlatform, [platformKey], signal);
  } else if (outcome === 'failed' || outcome === 'skipped') {
    await fetchData(platformKey, autoSlug, signal);
  }
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
  await loadPlatforms(currentPlatform, [platformKey], signal, opts);
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

  await loadPlatforms(currentPlatform, [platformKey], signal, opts);
}

/**
 * Not wrapped in `withBatch`: a batch snapshots every node up front and
 * overwrites them all at the end, so holding it across network requests wiped
 * whatever other tabs or the background cleanup wrote meanwhile.
 */
export function loadAllPlatformsData(
  currentPlatform: PlatformKey,
  otherPlatforms: Iterable<PlatformKey>,
  signal: AbortSignal,
  opts: PlatformActionOpts = {}
): void {
  loadPlatforms(currentPlatform, Array.from(otherPlatforms), signal, opts).catch((err) =>
    Logger.error(opts.loggerContext ?? 'PlatformActions', 'loadAllPlatformsData failed', err)
  );
}
