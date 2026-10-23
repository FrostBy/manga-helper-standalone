/**
 * MangaBuff API
 * Uses REST API + HTML parsing
 */

import { BasePlatformAPI, type Candidate } from './base';
import { Logger } from '@/src/utils/logger';
import { userProgress } from '@/src/utils/storage';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch } from '@/src/utils/manga';
import { yearIn, type TitleProfile } from '@/src/utils/matchScore';
import type { PlatformConfig, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

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
    return parseSlugFromUrl(url, ['mangabuff.ru'], /^\/manga\/([^/?#]+)/);
  }

  protected async candidatesFor(query: string, titles: string[]): Promise<Candidate[] | null> {
    const response = await this.fetch<MangaBuffSearchResult>(`${BASE_URL}/search/suggestions?q=${encodeURIComponent(query)}`);
    if (!response) return null;
    if (!Array.isArray(response)) return [];
    return response.filter((item) => titlesMatch([item.name], titles)).map(({ slug }) => ({ slug }));
  }

  async getProfile(slug: string): Promise<TitleProfile | null> {
    const html = await this.fetch<string>(`${BASE_URL}/manga/${slug}`);
    if (typeof html !== 'string') return null;
    const links = new DOMParser().parseFromString(html, 'text/html').querySelector('.manga__middle-links');
    return { year: yearIn(links?.textContent), authors: [], ids: {} };
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
      this.failedFetches++;
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
  async searchByQuery(query: string): Promise<Array<{ title: string; slug: string; image?: string }> | null> {
    const url = `${BASE_URL}/search/suggestions?q=${encodeURIComponent(query)}`;
    const response = await this.fetch<MangaBuffSearchResult>(url);

    if (!response) return null;
    if (!Array.isArray(response)) return [];

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
