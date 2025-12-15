/**
 * MangaLib API
 * Uses api.cdnlibs.org REST API
 */

import { BasePlatformAPI } from './base';
import { Logger } from '@/src/utils/logger';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const API_BASE = 'https://api.cdnlibs.org/api/manga';

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

  link(slug: string): string {
    return `https://mangalib.me/ru/manga/${slug}`;
  }

  getSlugFromURL(url: string): string | null {
    // https://mangalib.me/ru/manga/123--slug or /manga/123--slug
    const match = url.match(/\/manga\/(\d+--[^/?#]+)/);
    return match?.[1] ?? null;
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
      'site-id': '1',
      'Referer': 'https://mangalib.me/',
    };

    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }

    // Try each title until we find a match
    for (const title of titles) {
      if (signal?.aborted) return null;

      const params = new URLSearchParams({
        q: title,
        'site_id[]': '1', // mangalib
      });

      const url = `${API_BASE}?${params}`;
      const response = await this.fetch<{ data?: Array<{ slug_url?: string }> }>(url, { headers });

      Logger.debug(this.config.key, 'Search result for title', { title, found: response?.data?.[0]?.slug_url ?? null });

      if (response?.data?.[0]?.slug_url) {
        const foundSlug = response.data[0].slug_url;

        if (signal?.aborted) return null;

        // Get chapter data and cache it
        const data = await this.getData(foundSlug);
        if (data) {
          Logger.debug(this.config.key, 'Match found', foundSlug);
          // Save auto mapping
          await this.saveAutoMapping(sourcePlatform, sourceSlug, foundSlug);
          return data;
        }
      }
    }

    if (signal?.aborted) return null;

    Logger.debug(this.config.key, 'No match found');
    // No results - save negative mapping to prevent re-search
    await this.saveAutoMapping(sourcePlatform, sourceSlug, false);
    return null;
  }

  /**
   * Get manga metadata
   */
  async getManga(slug: string): Promise<Manga | null> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'site-id': '1',
      'Referer': 'https://mangalib.me/',
    };

    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }

    const url = `${API_BASE}/${slug}?fields[]=eng_name&fields[]=otherNames`;
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
      'site-id': '1',
      'Referer': 'https://mangalib.me/',
    };

    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }

    const url = `${API_BASE}/${slug}/chapters`;
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
      'site-id': '1',
      'Referer': 'https://mangalib.me/',
      'authorization': `Bearer ${token}`,
    };

    const url = `${API_BASE}/${slug}/bookmark`;
    const response = await this.fetch<MangaLibBookmarkResponse>(url, { headers });

    if (!response?.data?.item) return null;

    return {
      chapter: response.data.item.number,
      lastChapterRead: response.data.item.number,
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

    // Fetch chapters
    const chapters = await this.getChapters(slug);
    if (!chapters?.data?.length) return null;

    // Filter to free chapters only (no restricted_view or is_open: true)
    const freeChapters = chapters.data.filter((ch: any) => {
      const restricted = ch.branches?.[0]?.restricted_view;
      return !restricted || restricted.is_open === true;
    });

    // Get last free chapter number
    const lastChapter = freeChapters.at(-1)?.number ?? 0;

    // Get bookmark (last read chapter)
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
    const params = new URLSearchParams({ q: query, 'site_id[]': '1' });
    const url = `${API_BASE}?${params}`;
    const response = await this.fetch<MangaLibSearchResponse>(url, { headers: { 'site-id': '1' } });

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
