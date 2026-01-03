/**
 * MangaBuff API
 * Uses REST API + HTML parsing
 */

import { BasePlatformAPI } from './base';
import { Logger } from '@/src/utils/logger';
import { userProgress } from '@/src/utils/storage';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const BASE_URL = 'https://mangabuff.ru';

/**
 * MangaBuff Search API Response DTO
 * GET /search/suggestions?q={query}
 */
interface MangaBuffSearchItem {
  id: number;
  name: string;
  slug: string;
  release: string;
  rating: string;
  image: string; // relative path: /img/manga/posters/{slug}.jpg
  views: number;
  type_id: number;
  status_id: number;
  type: {
    id: number;
    name: string;
    slug: string;
    seo_title: string;
    description: string;
  };
  status: {
    id: number;
    name: string;
    slug: string;
    seo_title: string | null;
    description: string | null;
  };
  genres: Array<{
    name: string;
    pivot: { manga_id: number; genre_id: number };
  }>;
}

type MangaBuffSearchResult = MangaBuffSearchItem[];

export class MangaBuffAPI extends BasePlatformAPI {
  readonly config: PlatformConfig = {
    key: 'mangabuff',
    domain: 'mangabuff.ru',
    title: 'MangaBuff',
  };

  link(slug: string): string {
    return `${BASE_URL}/manga/${slug}`;
  }

  getSlugFromURL(url: string): string | null {
    // https://mangabuff.ru/manga/slug
    const match = url.match(/\/manga\/([^/?#]+)/);
    return match?.[1] ?? null;
  }

  /**
   * Search for manga by titles
   */
  async search(
    sourcePlatform: PlatformKey,
    sourceSlug: string,
    titles: string[],
    signal?: AbortSignal
  ): Promise<SearchResult | null> {
    Logger.debug(this.config.key, 'Search started', { titles });

    // Try each title sequentially (allows abort between requests)
    for (const title of titles) {
      if (signal?.aborted) return null;

      const slug = await this.searchByTitle(title, titles);
      Logger.debug(this.config.key, 'Search result for title', { title, found: slug });

      if (slug) {
        if (signal?.aborted) return null;

        // Get manga data
        const data = await this.getMangaData(slug);
        if (data) {
          Logger.debug(this.config.key, 'Match found', slug);
          // Save auto mapping
          await this.saveAutoMapping(sourcePlatform, sourceSlug, slug);
          // Cache result
          await this.cacheResult(slug, data.chapter, data.lastChapterRead);

          return this.prepareResponse(slug, data.chapter, data.lastChapterRead);
        }
      }
    }

    if (signal?.aborted) return null;

    Logger.debug(this.config.key, 'No match found');
    // No results - save negative mapping
    await this.saveAutoMapping(sourcePlatform, sourceSlug, false);
    return null;
  }

  /**
   * Search by single title, match result against all known titles
   */
  private async searchByTitle(title: string, allTitles: string[]): Promise<string | null> {
    const url = `${BASE_URL}/search/suggestions?q=${encodeURIComponent(title)}`;
    const response = await this.fetch<MangaBuffSearchResult>(url);

    // API returns array directly
    if (!response || !Array.isArray(response) || response.length === 0) {
      return null;
    }

    // Find match against any of our titles (covers alt name scenarios)
    const entity = response.find((e) => allTitles.includes(e.name));
    return entity?.slug ?? null;
  }

  /**
   * Get manga data by parsing HTML
   */
  private async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const url = `${BASE_URL}/manga/${slug}`;
    const html = await this.fetch<string>(url);

    if (!html || typeof html !== 'string') return null;

    try {
      // Parse HTML to extract chapter count
      // Looking for: .hot-chapters__wrapper .hot-chapters__number
      const chapterMatch = html.match(/class="hot-chapters__number"[^>]*>(\d+)/);
      const chapter = chapterMatch ? parseInt(chapterMatch[1], 10) : 0;

      // Read user's reading progress from extension storage
      // (saved by MangaBuff router when user visits MangaBuff site)
      const lastChapterRead = await userProgress.get(this.config.key, slug);

      return { chapter, lastChapterRead };
    } catch (error) {
      Logger.error(this.config.key, 'Failed to parse manga page', error);
      return null;
    }
  }

  /**
   * Get manga metadata (with fetch)
   */
  async getManga(slug: string): Promise<Manga | null> {
    const url = `${BASE_URL}/manga/${slug}`;
    const html = await this.fetch<string>(url);
    if (!html || typeof html !== 'string') return null;
    return this.parseMangaHTML(html);
  }

  /**
   * Parse manga metadata from HTML (no fetch)
   */
  parseMangaHTML(html: string): Manga | null {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Parse title
      const h1 = doc.querySelector('h1');
      const name = h1?.textContent?.trim();
      if (!name) return null;

      // Parse alternative titles
      const otherNames: string[] = [];
      const altSpans = doc.querySelectorAll('.manga__name-alt span');
      altSpans.forEach((span) => {
        const text = span.textContent?.trim();
        if (text) otherNames.push(text);
      });

      return { name, otherNames };
    } catch {
      return null;
    }
  }

  /**
   * Get chapters list
   */
  async getChapters(slug: string): Promise<ChaptersResponse | null> {
    const data = await this.getMangaData(slug);
    if (!data) return null;

    // Return synthetic chapters list
    const chapters = Array.from({ length: data.chapter }, (_, i) => ({
      number: i + 1,
    }));

    return { data: chapters };
  }

  /**
   * Get user's bookmark - not supported without auth
   */
  async getBookmark(_slug: string): Promise<Bookmark | null> {
    // MangaBuff doesn't have public bookmark API
    return null;
  }

  /**
   * Simple search by query - for popup use
   */
  async searchByQuery(query: string): Promise<Array<{ title: string; slug: string; image?: string }>> {
    const url = `${BASE_URL}/search/suggestions?q=${encodeURIComponent(query)}`;
    const response = await this.fetch<MangaBuffSearchResult>(url);

    if (!response || !Array.isArray(response)) return [];

    return response.slice(0, 5).map((item) => ({
      title: item.name || item.slug || '',
      slug: item.slug || '',
      image: item.image ? `${BASE_URL}${item.image}` : undefined,
    }));
  }

  /**
   * Get cached or fresh data
   */
  async getData(slug: string): Promise<SearchResult | null> {
    const cached = await this.getCached(slug);
    if (cached) {
      Logger.debug(this.config.key, 'Using cached data', slug);
      return this.prepareResponse(slug, cached.chapter, cached.lastChapterRead);
    }

    const data = await this.getMangaData(slug);
    if (!data) return null;

    await this.cacheResult(slug, data.chapter, data.lastChapterRead);
    return this.prepareResponse(slug, data.chapter, data.lastChapterRead);
  }
}

// Export singleton instance
export const mangabuffAPI = new MangaBuffAPI();
