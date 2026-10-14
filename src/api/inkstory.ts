/**
 * Inkstory API
 * Book and chapters come from the public REST API. The bookmark doesn't: the
 * API token stays on Inkstory's server, so it is read from the title page the
 * server renders for the logged-in user.
 */

import { BasePlatformAPI } from './base';
import { Logger } from '@/src/utils/logger';
import { userProgress } from '@/src/utils/storage';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch } from '@/src/utils/manga';
import { readingStats, parseBookmarkIds, type InkstoryChapter } from './inkstoryProgress';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const BASE_URL = 'https://inkstory.net';
const API_URL = 'https://api.inkstory.net/v2';

/**
 * Inkstory book DTO
 * GET /v2/books?search={query}&ignoreUserScopedContentStatus=true&serviceName=inkstory (array)
 * GET /v2/books/{slug}
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
    return `${BASE_URL}/content/${slug}/chapters`;
  }

  getSlugFromURL(url: string): string | null {
    return parseSlugFromUrl(url, ['inkstory.net', 'manga.ovh'], /^\/content\/([^/?#]+)/);
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

      const slug = await this.searchByTitle(title, titles);
      Logger.debug(this.config.key, 'Search result for title', { title, found: slug });

      if (slug) {
        if (signal?.aborted) return null;

        const data = await this.getMangaData(slug);
        if (data) {
          Logger.debug(this.config.key, 'Match found', slug);
          await this.cacheResult(slug, data.chapter, data.lastChapterRead);
          return this.prepareResponse(slug, data.chapter, data.lastChapterRead);
        }
      }
    }

    if (signal?.aborted) return null;

    Logger.debug(this.config.key, 'No match found');
    return null;
  }

  /**
   * Search by single title with title matching
   */
  private async searchByTitle(title: string, allTitles: string[]): Promise<string | null> {
    const url = `${API_URL}/books?search=${encodeURIComponent(title)}&ignoreUserScopedContentStatus=true&serviceName=inkstory`;
    const response = await this.fetch<InkstorySearchResult>(url);

    // API returns array directly
    if (!response || !Array.isArray(response) || response.length === 0) {
      return null;
    }

    const matched = response.find((book) =>
      titlesMatch(
        [...(book.altNames ?? []).map((alt) => alt.name), ...Object.values(book.name ?? {})],
        allTitles
      )
    );

    return matched?.slug ?? null;
  }

  private async fetchChapters(slug: string): Promise<InkstoryChapter[] | null> {
    const book = await this.fetch<InkstorySearchItem>(`${API_URL}/books/${slug}`);
    if (!book?.id) return null;
    const chapters = await this.fetch<InkstoryChapter[]>(`${API_URL}/chapters?bookId=${book.id}`);
    return Array.isArray(chapters) ? chapters : null;
  }

  async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const [chapters, html] = await Promise.all([
      this.fetchChapters(slug),
      this.fetch<string>(`${BASE_URL}/content/${slug}`, { withCredentials: true } as RequestInit),
    ]);
    if (!chapters || typeof html !== 'string') {
      // A malformed answer is a failure too; a request that failed is already
      // counted, but only the counter's change is ever read.
      this.failedFetches++;
      return null;
    }

    const stats = readingStats(chapters, parseBookmarkIds(html));
    // Logged out: the site keeps no bookmark, so use what ChapterPage saved.
    if (stats.lastChapterRead === 0) {
      stats.lastChapterRead = await userProgress.get(this.config.key, slug);
    }
    return stats;
  }

  async getChapterPosition(slug: string, chapterId: string): Promise<number> {
    const chapters = await this.fetchChapters(slug);
    return chapters ? readingStats(chapters, [chapterId]).lastChapterRead : 0;
  }

  async getManga(slug: string): Promise<Manga | null> {
    const book = await this.fetch<InkstorySearchItem>(`${API_URL}/books/${slug}`);
    const { ru, en, original } = book?.name ?? {};
    const [name, ...otherNames] = [ru, en, original, ...(book?.altNames ?? []).map((alt) => alt.name)]
      .filter((title): title is string => !!title);
    return name ? { name, otherNames, cover: book?.poster } : null;
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
    const url = `${API_URL}/books?search=${encodeURIComponent(query)}&ignoreUserScopedContentStatus=true&serviceName=inkstory`;
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
