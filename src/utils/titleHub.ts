/**
 * MangaBaka maps MyAnimeList, AniList and MangaUpdates IDs to one series, so
 * titles from sites that carry different IDs can still be compared — and a
 * site without a year or Latin author names gets them from the series.
 */
import { storage } from '@wxt-dev/storage';
import { bgFetch } from './fetch';
import { createLock } from './lock';
import { Logger } from './logger';
import { yearIn, type TitleIds } from './matchScore';

const API = 'https://api.mangabaka.org/v1';
/** Versioned: an entry of another shape would be read with the wrong meaning. */
const CACHE_KEY = 'local:hubSeries.v2';
const HIT_TTL = 30 * 24 * 60 * 60 * 1000;
/** A title MangaBaka doesn't know yet may be added soon. */
const MISS_TTL = 24 * 60 * 60 * 1000;
/** While MangaBaka is down every candidate would wait out the 10 s timeout and keep its row spinning. */
const OUTAGE_PAUSE = 60 * 1000;

interface HubRecord {
  /** The series, or the one it was merged into. */
  series: number[];
  /** Alternatives: other editions and remakes alike, so only related. */
  related: number[];
  year?: number;
  authors: string[];
}

type CachedRecord = HubRecord & { expires: number };

interface HubSeries {
  id: number;
  merged_with: number | null;
  relationships: { alternative?: number[] } | null;
  year?: number | null;
  authors?: string[] | null;
  artists?: string[] | null;
}

const cacheLock = createLock('hubSeries');
let downUntil = 0;

const PATHS: Array<[keyof TitleIds, (id: string) => string]> = [
  ['baka', (id) => `/series/${id}`],
  ['mal', (id) => `/source/my-anime-list/${id}`],
  ['al', (id) => `/source/anilist/${id}`],
  ['mu', (id) => `/source/manga-updates/${id}`],
];

const EMPTY: HubRecord = { series: [], related: [], authors: [] };

function recordOf(list: HubSeries[]): HubRecord {
  const [main] = list;
  return {
    series: [...new Set(list.map((s) => s.merged_with ?? s.id))],
    related: [...new Set(list.flatMap((s) => s.relationships?.alternative ?? []))],
    year: yearIn(main?.year),
    authors: [...new Set([...(main?.authors ?? []), ...(main?.artists ?? [])])],
  };
}

/** A 200 that isn't MangaBaka's JSON (a challenge page) is a failure, not "unknown title". */
async function fetchRecord(path: string): Promise<HubRecord | undefined> {
  const result = await bgFetch<{ data?: { series?: unknown } & Partial<HubSeries> }>(API + path);
  if (!result.ok) return result.status === 404 ? EMPTY : undefined;
  const data = typeof result.data === 'object' ? result.data?.data : undefined;
  if (!data) return undefined;
  if (Array.isArray(data.series)) return recordOf(data.series as HubSeries[]);
  return typeof data.id === 'number' ? recordOf([data as HubSeries]) : undefined;
}

async function remember(key: string, record: HubRecord): Promise<void> {
  try {
    await cacheLock(async () => {
      const now = Date.now();
      const all = (await storage.getItem<Record<string, CachedRecord>>(CACHE_KEY)) ?? {};
      for (const [stale, entry] of Object.entries(all)) if (entry.expires <= now) delete all[stale];
      all[key] = { ...record, expires: now + (record.series.length ? HIT_TTL : MISS_TTL) };
      await storage.setItem(CACHE_KEY, all);
    });
  } catch (error) {
    Logger.warn('titleHub', 'Cache write failed', error);
  }
}

async function lookup(kind: keyof TitleIds, id: string, path: string): Promise<HubRecord | undefined> {
  const key = `${kind}:${id}`;
  const cached = (await storage.getItem<Record<string, CachedRecord>>(CACHE_KEY))?.[key];
  if (cached && cached.expires > Date.now()) return cached;
  if (Date.now() < downUntil) return undefined;

  const record = await fetchRecord(path);
  if (!record) {
    downUntil = Date.now() + OUTAGE_PAUSE;
    return undefined;
  }
  await remember(key, record);
  return record;
}

/**
 * `undefined` when MangaBaka didn't answer — the caller compares raw IDs then.
 * An ID MangaBaka doesn't know gives way to the title's next one.
 */
export async function resolveHub(ids: TitleIds): Promise<HubRecord | undefined> {
  for (const [kind, path] of PATHS) {
    const id = ids[kind];
    if (!id) continue;
    const record = await lookup(kind, id, path(id));
    if (!record || record.series.length) return record;
  }
  return EMPTY;
}
