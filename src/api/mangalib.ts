/**
 * MangaLib API
 * Uses api.cdnlibs.org REST API
 */

import { BasePlatformAPI } from './base';
import { Logger } from '@/src/utils/logger';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark, Chapter } from '@/src/types';

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

const DEFAULT_API_BASE = 'https://api.cdnlibs.org/api/manga';

interface MirrorConfig {
  apiBase: string;
  siteId: string;
  tokenKey: string;
}

export const MANGALIB_MIRROR_CONFIGS: Record<string, MirrorConfig> = {
  'hentailib.me': {
    apiBase: 'https://hapi.hentaicdn.org/api/manga',
    siteId: '4',
    tokenKey: 'hentailib',
  },
};

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
    [key: string]: unknown;
  };
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

  private apiBase = DEFAULT_API_BASE;
  private siteId = '1';
  private domainUrl = 'https://mangalib.me';

  /** Apply mirror config by domain */
  applyMirror(domain: string): void {
    const mirror = MANGALIB_MIRROR_CONFIGS[domain];
    if (mirror) {
      this.apiBase = mirror.apiBase;
      this.siteId = mirror.siteId;
      this.domainUrl = `https://${domain}`;
      this.tokenKey = mirror.tokenKey;
    }
  }

  link(slug: string): string {
    return `${this.domainUrl}/ru/manga/${slug}`;
  }

  getSlugFromURL(url: string): string | null {
    return parseSlugFromUrl(
      url,
      ['mangalib.me', 'mangalib.org', 'hentailib.me'],
      /\/manga\/(\d+--[^/?#]+)/
    );
  }

  /**
   * Search manga by titles
   */
  async search(
    sourcePlatform: PlatformKey,
    sourceSlug: string,
    titles: string[],
    signal?: AbortSignal
  ): Promise<SearchResult | null> {
    Logger.debug(this.config.key, 'Search started', { titles });

    const token = await this.getToken();
    const headers: Record<string, string> = {
      'site-id': this.siteId,
    };

    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }

    // Try each title until we find a match
    for (const title of titles) {
      if (signal?.aborted) return null;

      const params = new URLSearchParams({
        q: title,
        'site_id[]': this.siteId,
      });

      const url = `${this.apiBase}?${params}`;
      const response = await this.fetch<{ data?: Array<{ slug_url?: string }> }>(url, { headers });

      Logger.debug(this.config.key, 'Search result for title', { title, found: response?.data?.[0]?.slug_url ?? null });

      if (response?.data?.[0]?.slug_url) {
        const foundSlug = response.data[0].slug_url;

        if (signal?.aborted) return null;

        // Get chapter data and cache it
        const data = await this.getData(foundSlug);
        if (data) {
          Logger.debug(this.config.key, 'Match found', foundSlug);
          return data;
        }
      }
    }

    if (signal?.aborted) return null;

    Logger.debug(this.config.key, 'No match found');
    return null;
  }

  /**
   * Get manga metadata
   */
  async getManga(slug: string): Promise<Manga | null> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'site-id': this.siteId,
    };

    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }

    const url = `${this.apiBase}/${slug}?fields[]=eng_name&fields[]=otherNames`;
    const response = await this.fetch<MangaLibMeta>(url, { headers });

    if (!response?.data) return null;

    const { data } = response;
    return {
      slug,
      name: data.name || slug,
      rus_name: data.rus_name,
      eng_name: data.eng_name,
      otherNames: data.otherNames,
      cover: data.cover?.default,
    };
  }

  /**
   * Get chapters list
   */
  async getChapters(slug: string): Promise<ChaptersResponse | null> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'site-id': this.siteId,
    };

    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }

    const url = `${this.apiBase}/${slug}/chapters`;
    return this.fetch<ChaptersResponse>(url, { headers });
  }

  /**
   * Get user's bookmark/progress
   */
  async getBookmark(slug: string): Promise<Bookmark | null> {
    const token = await this.getToken();

    // Bookmark requires authentication
    if (!token) return null;

    const headers: Record<string, string> = {
      'site-id': this.siteId,
      'authorization': `Bearer ${token}`,
    };

    const url = `${this.apiBase}/${slug}/bookmark`;
    const response = await this.fetch<MangaLibBookmarkResponse>(url, { headers });

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

    // Fetch chapters (typed with MangaLib branches for paid-access filter)
    const token = await this.getToken();
    const chHeaders: Record<string, string> = { 'site-id': this.siteId };
    if (token) chHeaders['authorization'] = `Bearer ${token}`;
    const chapters = await this.fetch<MangaLibChaptersResponse>(
      `${this.apiBase}/${slug}/chapters`,
      { headers: chHeaders }
    );
    if (!chapters?.data?.length) return null;

    // Filter to free chapters only (no restricted_view or is_open: true)
    const freeChapters = chapters.data.filter((ch) => {
      const restricted = ch.branches?.[0]?.restricted_view;
      return !restricted || restricted.is_open === true;
    });

    // Prefer cumulative `item_number` (1..N across all volumes) so titles
    // that reset numbering between volumes ("Том 1 гл. 85 → Том 2 гл. 1")
    // still show the real total. Fall back to `number` if missing.
    const last = freeChapters.at(-1);
    const lastChapter = Number(last?.item_number) || Number(last?.number) || 0;

    const bookmark = await this.getBookmark(slug);
    const lastChapterRead = bookmark?.lastChapterRead ?? 0;

    // Cache result
    await this.cacheResult(slug, lastChapter, lastChapterRead);

    return this.prepareResponse(slug, lastChapter, lastChapterRead);
  }

  /**
   * Simple search by query - for popup use
   */
  async searchByQuery(query: string): Promise<Array<{ title: string; slug: string; image?: string }>> {
    const params = new URLSearchParams({ q: query, 'site_id[]': this.siteId });
    const url = `${this.apiBase}?${params}`;
    const response = await this.fetch<MangaLibSearchResponse>(url, { headers: { 'site-id': this.siteId } });

    if (!response?.data) return [];

    return response.data.slice(0, 5).map((item) => ({
      title: item.rus_name || item.name || item.slug_url || '',
      slug: item.slug_url || '',
      image: item.cover?.thumbnail,
    }));
  }

  /**
   * Collect all titles for search on other platforms
   */
  async getTitles(slug: string): Promise<string[]> {
    const manga = await this.getManga(slug);
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
