/**
 * MangaLib API — the Lib ecosystem (MangaLib, HentaiLib) through its REST API
 */

import { BasePlatformAPI, type Candidate, type QueryItem } from './base';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch } from '@/src/utils/manga';
import { yearIn, type TitleProfile } from '@/src/utils/matchScore';
import { currentHost, setTitleChain, titleChain } from '@/src/utils/mirrors';
import type { HostPool } from '@/src/utils/hostPool';
import type { PlatformConfig, SearchResult, Manga, ChaptersResponse, Bookmark, Chapter } from '@/src/types';

/** One API for every Lib site; the `Site-Id` header picks the catalog. */
const API_POOL: HostPool = {
  id: 'lib:api',
  hosts: ['https://api.imglib.info', 'https://api.lib.social', 'https://api2.mangalib.me', 'https://api.cdnlibs.org'],
};

type LibChain = 'manga' | 'hentai';

/** Separate catalogs: a hentai title answers 404 under the manga Site-Id. */
const CHAINS: Record<LibChain, { siteId: string; group: string; sites: HostPool }> = {
  manga: { siteId: '1', group: 'MangaLib', sites: { id: 'lib:manga', hosts: ['https://mangalib.me', 'https://mangalib.org'] } },
  hentai: { siteId: '4', group: 'HentaiLib', sites: { id: 'lib:hentai', hosts: ['https://hentailib.me', 'https://kz.hentailib.me'] } },
};
const CHAIN_ORDER: LibChain[] = ['manga', 'hentai'];

/** R4.3: MangaLib-specific chapter with paid-access branch metadata.
 * `item_number` — cumulative ordinal across all volumes (1, 2, ..., 95).
 * Use it for total chapter count; `number` is per-volume and can reset
 * (some teams number "Том 1 гл. 85 → Том 2 гл. 1" which breaks naïve counting). */
export interface MangaLibChapter extends Chapter {
  item_number?: number;
  branches?: Array<{
    restricted_view?: { is_open?: boolean };
  }>;
}

interface MangaLibChaptersResponse {
  data: MangaLibChapter[];
}

/**
 * MangaLib Search API Response DTO
 * GET /api/manga?q={query}&site_id[]=1
 */
interface MangaLibSearchItem {
  id: number;
  name: string;
  rus_name: string;
  eng_name: string;
  model: string;
  slug: string;
  slug_url: string;
  cover: {
    filename: string;
    thumbnail: string; // https://cover.imglib.info/uploads/cover/{slug}/cover/{filename}_thumb.jpg
    default: string;   // https://cover.imglib.info/uploads/cover/{slug}/cover/{filename}_250x350.jpg
    md: string;
  };
  ageRestriction: {
    id: number;
    label: string;
  };
  site: number;
  type: {
    id: number;
    label: string;
  };
  releaseDate: string;
  rating: {
    average: string;
    averageFormated: string;
    votes: number;
    votesFormated: string;
    user: number;
  };
  content_marking: unknown[];
  status: {
    id: number;
    label: string;
  };
  releaseDateString: string;
}

interface MangaLibSearchResponse {
  data: MangaLibSearchItem[];
  links: {
    first: string;
    last: string | null;
    prev: string | null;
    next: string | null;
  };
  meta: {
    current_page: number;
    from: number;
    path: string;
    per_page: number;
    to: number;
    page: number;
    has_next_page: boolean;
    seed: string;
  };
}

interface MangaLibMeta {
  data?: {
    name?: string;
    rus_name?: string;
    eng_name?: string;
    otherNames?: string[];
    cover?: { default?: string };
    is_licensed?: boolean;
    authors?: Array<{ name?: string }>;
    artists?: Array<{ name?: string }>;
    releaseDate?: string;
    [key: string]: unknown;
  };
}

const META_FIELDS = ['eng_name', 'otherNames', 'authors', 'artists', 'releaseDate'].map((field) => `fields[]=${field}`).join('&');

/**
 * Licensed titles count every chapter: everything past the preview is locked
 * with no way to buy it, and counting only open ones turns 118 chapters into 6.
 */
export function lastAvailableChapter(chapters: MangaLibChapter[], isLicensed: boolean): number {
  const counted = isLicensed
    ? chapters
    : chapters.filter((ch) => {
        const restricted = ch.branches?.[0]?.restricted_view;
        return !restricted || restricted.is_open === true;
      });
  // `item_number` is cumulative across volumes; `number` can restart per volume.
  const last = counted.at(-1);
  return Number(last?.item_number) || Number(last?.number) || 0;
}

interface MangaLibBookmarkResponse {
  data?: {
    // `meta.item_number` — cumulative chapter number for the bookmark.
    // Prefer it over `item.number` which is per-volume and can reset.
    meta?: { item_number?: number; [key: string]: unknown };
    item?: {
      number: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

export class MangaLibAPI extends BasePlatformAPI {
  readonly config: PlatformConfig = {
    key: 'mangalib',
    domain: 'mangalib.me',
    title: 'Mangalib',
  };

  protected apiPool = API_POOL;
  protected sitePools = { manga: CHAINS.manga.sites, hentai: CHAINS.hentai.sites };

  link(slug: string, chain?: string): string {
    const { sites } = CHAINS[(chain ?? titleChain('mangalib', slug)) as LibChain] ?? CHAINS.manga;
    return `${currentHost(sites)}/ru/manga/${slug}`;
  }

  private async requestApi<T>(path: string, chain: LibChain, notFoundIsAnswer = false) {
    const token = await this.getToken();
    const headers: Record<string, string> = { 'site-id': CHAINS[chain].siteId };
    if (token) headers.authorization = `Bearer ${token}`;
    return this.requestPool<T>(API_POOL, `/api/manga${path}`, { headers }, { notFoundIsAnswer });
  }

  private async api<T>(path: string, chain: LibChain, notFoundIsAnswer = false): Promise<T | null> {
    const result = await this.requestApi<T>(path, chain, notFoundIsAnswer);
    return result.ok ? result.data : null;
  }

  /** Guests get the same 404 for licensed titles, so without a token nothing reads as gone. */
  async titleGone(slug: string): Promise<boolean> {
    if (!(await this.getToken())) return false;
    const result = await this.requestApi(`/${slug}`, this.chainOf(slug), true);
    return !result.ok && result.status === 404;
  }

  private chainOf(slug: string): LibChain {
    return titleChain('mangalib', slug) as LibChain;
  }

  getSlugFromURL(url: string): string | null {
    return parseSlugFromUrl(
      url,
      ['mangalib.me', 'mangalib.org', 'hentailib.me'],
      /\/manga\/(\d+--[^/?#]+)/
    );
  }

  /** MangaLib first under every name: a HentaiLib namesake of one name must not beat MangaLib's title under another. */
  protected candidatesFor(query: string, titles: string[]): Promise<Candidate[] | null> {
    return this.catalogCandidates(query, titles, 'manga');
  }

  protected async fallbackCandidates(titles: string[], signal?: AbortSignal): Promise<Candidate[]> {
    const found: Candidate[] = [];
    for (const title of titles) {
      if (signal?.aborted) break;
      const hits = await this.catalogCandidates(title, titles, 'hentai');
      // Every host already failed with its retries — the other names would too.
      if (!hits) break;
      found.push(...hits);
    }
    return found;
  }

  /**
   * Catalogs are searched separately: a combined site_id query returns only
   * manga. Search is fuzzy — its top hit is often a different title, so a hit
   * only counts if one of its names matches. Alt names aren't in the search
   * payload, hence the extra lookup for the top hit.
   */
  private async catalogCandidates(query: string, titles: string[], chain: LibChain): Promise<Candidate[] | null> {
    const params = new URLSearchParams({ q: query, 'site_id[]': CHAINS[chain].siteId });
    const response = await this.api<MangaLibSearchResponse>(`?${params}`, chain);
    if (!response) return null;
    const items = response.data ?? [];
    const matched: Candidate[] = items
      .filter((item) => titlesMatch([item.name, item.rus_name, item.eng_name], titles))
      .map((item) => ({ slug: item.slug_url, chain }));
    const top = items[0]?.slug_url;
    if (!matched.length && top && titlesMatch(this.titlesOf(await this.getManga(top, chain)), titles)) {
      matched.push({ slug: top, chain });
    }
    return matched;
  }

  async getProfile(slug: string, chain?: string): Promise<TitleProfile | null> {
    const meta = await this.fetchMeta(slug, chain as LibChain | undefined);
    if (!meta) return null;
    const people = [...(meta.authors ?? []), ...(meta.artists ?? [])];
    return { year: yearIn(meta.releaseDate), authors: people.map((p) => p.name ?? '').filter(Boolean), ids: {} };
  }

  /**
   * Metadata answers only under the title's own catalog: the known one is tried
   * first, then the rest — titles move between catalogs, and a manual link
   * arrives with none known.
   */
  private fetchMeta(slug: string, preferred?: LibChain): Promise<NonNullable<MangaLibMeta['data']> | null> {
    return this.shared(`meta:${slug}`, async () => {
      const first = preferred ?? this.chainOf(slug);
      for (const chain of [first, ...CHAIN_ORDER.filter((c) => c !== first)]) {
        const response = await this.api<MangaLibMeta>(`/${slug}?${META_FIELDS}`, chain, true);
        if (!response?.data) continue;

        await setTitleChain('mangalib', slug, chain);
        this.probeSiteHost(CHAINS[chain].sites);
        return response.data;
      }
      return null;
    });
  }

  async getManga(slug: string, preferred?: LibChain): Promise<Manga | null> {
    const data = await this.fetchMeta(slug, preferred);
    return (
      data && {
        slug,
        name: data.name || slug,
        rus_name: data.rus_name,
        eng_name: data.eng_name,
        otherNames: data.otherNames,
        cover: data.cover?.default,
        isLicensed: data.is_licensed === true,
      }
    );
  }

  async getChapters(slug: string): Promise<ChaptersResponse | null> {
    return this.api<ChaptersResponse>(`/${slug}/chapters`, this.chainOf(slug), true);
  }

  async getBookmark(slug: string): Promise<Bookmark | null> {
    if (!(await this.getToken())) return null;
    const response = await this.api<MangaLibBookmarkResponse>(`/${slug}/bookmark`, this.chainOf(slug), true);

    if (!response?.data) return null;

    // Prefer cumulative `meta.item_number` (95 for the 95th chapter overall).
    // Fall back to `item.number` for old/odd responses. Coerce to number to
    // avoid string concat (e.g. "180" + 0 → "1800").
    const n =
      Number(response.data.meta?.item_number) ||
      Number(response.data.item?.number) ||
      0;
    return {
      chapter: n,
      lastChapterRead: n,
    };
  }

  /**
   * Get manga data (chapters + bookmark) with caching
   */
  async getData(slug: string): Promise<SearchResult | null> {
    // Check cache first
    const cached = await this.getCached(slug);
    if (cached) {
      return this.prepareResponse(slug, cached.chapter, cached.lastChapterRead);
    }

    // Metadata first: it settles the title's catalog the bookmark is asked under.
    const manga = await this.getManga(slug);
    const [chapters, bookmark] = await Promise.all([
      this.api<MangaLibChaptersResponse>(`/${slug}/chapters`, this.chainOf(slug), true),
      this.getBookmark(slug),
    ]);
    if (!chapters?.data) return null;

    const lastChapter = lastAvailableChapter(chapters.data, manga?.isLicensed === true);
    const lastChapterRead = bookmark?.lastChapterRead ?? 0;

    // Cache result
    await this.cacheResult(slug, lastChapter, lastChapterRead);

    return this.prepareResponse(slug, lastChapter, lastChapterRead);
  }

  async searchByQuery(query: string): Promise<QueryItem[] | null> {
    const perChain = await Promise.all(
      CHAIN_ORDER.map(async (chain): Promise<QueryItem[] | null> => {
        const params = new URLSearchParams({ q: query, 'site_id[]': CHAINS[chain].siteId });
        const response = await this.api<MangaLibSearchResponse>(`?${params}`, chain);
        if (!response) return null;
        this.probeSiteHost(CHAINS[chain].sites);
        return (response.data ?? []).map((item) => ({
          title: item.rus_name || item.name || item.slug_url || '',
          slug: item.slug_url || '',
          image: item.cover?.thumbnail,
          chain,
          group: CHAINS[chain].group,
        }));
      })
    );
    if (perChain.every((items) => items === null)) return null;
    return perChain.flatMap((items, i) => items ?? [{ failedGroup: CHAINS[CHAIN_ORDER[i]].group }]);
  }

  /**
   * Collect all titles for search on other platforms
   */
  async getTitles(slug: string): Promise<string[]> {
    return this.titlesOf(await this.getManga(slug));
  }

  titlesOf(manga: Manga | null): string[] {
    if (!manga) return [];

    const titles: string[] = [];

    // rus_name first (most likely to match on Russian platforms)
    if (manga.rus_name) titles.push(manga.rus_name);
    if (manga.name) titles.push(manga.name);
    if (manga.eng_name) titles.push(manga.eng_name);
    if (manga.otherNames) titles.push(...manga.otherNames);

    // Filter duplicates and empty strings
    return [...new Set(titles.filter(Boolean))];
  }
}

// Export singleton instance
export const mangalibAPI = new MangaLibAPI();
