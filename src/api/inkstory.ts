/**
 * Inkstory API
 * Uses REST API + Astro component parsing
 */

import { BasePlatformAPI } from './base';
import { Logger } from '@/src/utils/logger';
import { userProgress } from '@/src/utils/storage';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const BASE_URL = 'https://inkstory.net';
const API_URL = 'https://api.inkstory.net/v2/books';

/**
 * Inkstory Search API Response DTO
 * GET /v2/books?search={query}&ignoreUserScopedContentStatus=true&serviceName=inkstory
 * Returns array directly
 */
interface InkstorySearchItem {
  id: string;
  slug: string;
  type: string;
  serviceName: string;
  poster: string; // https://static.inkstory.net/book/{id}/poster/{filename}.jpeg
  background: string | null;
  backgroundColor: string | null;
  featuredCharacter: string | null;
  featuredCharacterPreview: string | null;
  featuredCharacterBackground: string | null;
  featuredCharacterAnimation: Array<{ source: string; type: string }> | null;
  featuredCharacterAnimationWithMask: { source: string; type: string } | null;
  featuredCharacterAnimationFirstFrame: string | null;
  status: string;
  contentStatus: string;
  name: {
    en?: string;
    ru?: string;
    original?: string;
  };
  altNames: Array<{
    language: string;
    name: string;
  }>;
  country: string;
  year: number;
  formats: string[];
  featured: boolean;
  viewsCount: number;
  likesCount: number;
  bookmarksCount: number;
  ratingVotesCount: number;
  averageRating: number;
  chaptersCount: number;
  createdAt: string;
  updatedAt: string;
}

type InkstorySearchResult = InkstorySearchItem[];

export class InkstoryAPI extends BasePlatformAPI {
  readonly config: PlatformConfig = {
    key: 'inkstory',
    domain: 'inkstory.net',
    title: 'Inkstory',
  };

  link(slug: string): string {
    return `${BASE_URL}/content/${slug}?tab=chapters`;
  }

  getSlugFromURL(url: string): string | null {
    // https://inkstory.net/content/slug
    const match = url.match(/\/content\/([^/?#]+)/);
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

    for (const title of titles) {
      if (signal?.aborted) return null;

      const slug = await this.searchByTitle(title);
      Logger.debug(this.config.key, 'Search result for title', { title, found: slug });

      if (slug) {
        if (signal?.aborted) return null;

        const data = await this.getMangaData(slug);
        if (data) {
          Logger.debug(this.config.key, 'Match found', slug);
          await this.saveAutoMapping(sourcePlatform, sourceSlug, slug);
          await this.cacheResult(slug, data.chapter, data.lastChapterRead);
          return this.prepareResponse(slug, data.chapter, data.lastChapterRead);
        }
      }
    }

    if (signal?.aborted) return null;

    Logger.debug(this.config.key, 'No match found');
    await this.saveAutoMapping(sourcePlatform, sourceSlug, false);
    return null;
  }

  /**
   * Search by single title with title matching
   */
  private async searchByTitle(title: string): Promise<string | null> {
    const url = `${API_URL}?search=${encodeURIComponent(title)}&ignoreUserScopedContentStatus=true&serviceName=inkstory`;
    const response = await this.fetch<InkstorySearchResult>(url);

    // API returns array directly
    if (!response || !Array.isArray(response) || response.length === 0) {
      return null;
    }

    // Find matching book by altNames or name values
    const matched = response.find((book) => {
      const altMatch = book.altNames?.some((alt) => alt.name === title);
      const nameMatch = book.name && Object.values(book.name).some((name) => name === title);
      return altMatch || nameMatch;
    });

    return matched?.slug ?? null;
  }

  /**
   * Get manga data by parsing it-astro-state script (devalue format)
   * Contains: chaptersCount, current-book-bookmarks with chapter number
   */
  private async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const url = `${BASE_URL}/content/${slug}?tab=chapters`;

    // Use cookies for authenticated data (bookmarks)
    const html = await this.fetch<string>(url, { withCredentials: true } as RequestInit);

    if (!html || typeof html !== 'string') return null;

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Parse it-astro-state script (devalue format)
      const stateScript = doc.querySelector('script#it-astro-state');
      if (!stateScript?.textContent) {
        Logger.warn(this.config.key, 'Could not find it-astro-state script');
        return null;
      }

      const data = JSON.parse(stateScript.textContent);
      if (!Array.isArray(data)) return null;

      let chapter = 0;
      let lastChapterRead = 0;

      // Find chaptersCount - first (biggest) is total (sum of all translators)
      // Sort descending: if 1 element take it, otherwise take second (largest translator)
      const chapterCounts: number[] = [];
      for (const item of data) {
        if (item && typeof item === 'object' && !Array.isArray(item) && 'chaptersCount' in item) {
          const countIndex = (item as Record<string, unknown>).chaptersCount;
          if (typeof countIndex === 'number' && typeof data[countIndex] === 'number') {
            chapterCounts.push(data[countIndex] as number);
          }
        }
      }
      chapterCounts.sort((a, b) => b - a);
      chapter = chapterCounts.length === 1 ? chapterCounts[0] : chapterCounts[1] ?? 0;

      // Find bookmark chapter number - take max from all bookmarks
      const bookmarkChapters: number[] = [];
      for (const item of data) {
        if (item && typeof item === 'object' && !Array.isArray(item) && 'chapter' in item && 'userId' in item) {
          const chapterIdx = (item as Record<string, unknown>).chapter;
          if (typeof chapterIdx === 'number') {
            const chapterData = data[chapterIdx] as Record<string, unknown> | undefined;
            if (chapterData && typeof chapterData === 'object' && 'number' in chapterData) {
              const numIdx = chapterData.number;
              if (typeof numIdx === 'number' && typeof data[numIdx] === 'number') {
                bookmarkChapters.push(data[numIdx] as number);
              }
            }
          }
        }
      }
      if (bookmarkChapters.length > 0) {
        lastChapterRead = Math.max(...bookmarkChapters);
      }

      // Fallback: read from userProgress storage (saved when user visits Inkstory)
      if (lastChapterRead === 0) {
        lastChapterRead = await userProgress.get(this.config.key, slug);
      }

      return { chapter, lastChapterRead };
    } catch (error) {
      Logger.error(this.config.key, 'Failed to parse manga page', error);
      return null;
    }
  }

  /**
   * Get manga metadata
   */
  async getManga(slug: string): Promise<Manga | null> {
    const url = `${BASE_URL}/content/${slug}`;
    const html = await this.fetch<string>(url);

    if (!html || typeof html !== 'string') return null;

    try {
      // Parse title
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      const name = titleMatch ? titleMatch[1].trim() : slug;

      return { slug, name };
    } catch {
      return { slug, name: slug };
    }
  }

  /**
   * Get chapters list
   */
  async getChapters(slug: string): Promise<ChaptersResponse | null> {
    const data = await this.getMangaData(slug);
    if (!data) return null;

    const chapters = Array.from({ length: data.chapter }, (_, i) => ({
      number: i + 1,
    }));

    return { data: chapters };
  }

  /**
   * Get user's bookmark
   */
  async getBookmark(_slug: string): Promise<Bookmark | null> {
    // Would need authentication
    return null;
  }

  /**
   * Simple search by query - for popup use
   */
  async searchByQuery(query: string): Promise<Array<{ title: string; slug: string; image?: string }>> {
    const url = `${API_URL}?search=${encodeURIComponent(query)}&ignoreUserScopedContentStatus=true&serviceName=inkstory`;
    const response = await this.fetch<InkstorySearchResult>(url);

    if (!response || !Array.isArray(response)) return [];

    return response.slice(0, 5).map((item) => ({
      title: item.name?.ru || item.name?.en || Object.values(item.name || {})[0] || item.slug || '',
      slug: item.slug || '',
      image: item.poster || undefined,
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
export const inkstoryAPI = new InkstoryAPI();
