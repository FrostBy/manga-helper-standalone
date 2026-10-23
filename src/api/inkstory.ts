/**
 * Inkstory API
 * Book and chapters come from the public REST API. The bookmark doesn't: the
 * API token stays on Inkstory's server, so it is read from the title page the
 * server renders for the logged-in user.
 */

import { BasePlatformAPI, type Candidate, type QueryItem } from './base';
import { Logger } from '@/src/utils/logger';
import { userProgress } from '@/src/utils/storage';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch } from '@/src/utils/manga';
import { idsInLinks, type TitleProfile } from '@/src/utils/matchScore';
import { currentHost, titleChain } from '@/src/utils/mirrors';
import type { HostPool } from '@/src/utils/hostPool';
import { readingStats, parseBookmarkIds, type InkstoryChapter } from './inkstoryProgress';
import type { PlatformConfig, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const API_URL = 'https://api.inkstory.net/v2';

type InkChain = 'manga' | 'hentai';

const SITE_POOLS: Record<InkChain, HostPool> = {
  manga: { id: 'inkstory:manga', hosts: ['https://inkstory.net'] },
  hentai: { id: 'inkstory:hentai', hosts: ['https://v1.puremanga.me'] },
};

/** One API serves both sites; the service name picks the catalog — a PureManga book 404s without it. */
const SERVICES: Record<InkChain, string> = { manga: 'inkstory', hentai: 'puremanga.me' };

/** Auto-linking prefers the main catalog when a title is on both. */
const CHAIN_ORDER: InkChain[] = ['manga', 'hentai'];

const GROUPS: Record<InkChain, string> = { manga: 'Inkstory', hentai: 'PureManga' };

const chainOfTitle = (slug: string): InkChain => (titleChain('inkstory', slug) === 'hentai' ? 'hentai' : 'manga');

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
  year: number | null;
  /** MangaUpdates and MangaBaka links; only in the book lookup, not in search results. */
  externalLinks?: string[];
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

  protected sitePools = SITE_POOLS;

  link(slug: string, chain?: string): string {
    const pool = SITE_POOLS[(chain ?? chainOfTitle(slug)) as InkChain] ?? SITE_POOLS.manga;
    return `${currentHost(pool)}/content/${slug}/chapters`;
  }

  getSlugFromURL(url: string): string | null {
    return parseSlugFromUrl(url, ['inkstory.net', 'manga.ovh', 'puremanga.me'], /^\/content\/([^/?#]+)/);
  }

  /** Inkstory first under every name: an Inkstory match wins over PureManga (spec), and PureManga is still asked when Inkstory's are all rejected. */
  protected candidatesFor(query: string, titles: string[]): Promise<Candidate[] | null> {
    return this.catalogCandidates(query, titles, 'manga');
  }

  protected async fallbackCandidates(titles: string[], signal?: AbortSignal): Promise<Candidate[]> {
    const found: Candidate[] = [];
    for (const title of titles) {
      if (signal?.aborted) break;
      const hits = await this.catalogCandidates(title, titles, 'hentai');
      if (!hits) break;
      found.push(...hits);
    }
    return found;
  }

  private async catalogCandidates(query: string, titles: string[], chain: InkChain): Promise<Candidate[] | null> {
    const response = await this.searchBooks(query, chain);
    if (!Array.isArray(response)) return null;
    return response
      .filter((book) => book.slug && titlesMatch([...(book.altNames ?? []).map((alt) => alt.name), ...Object.values(book.name ?? {})], titles))
      .map(({ slug }) => ({ slug, chain }));
  }

  async getProfile(slug: string, chain?: string): Promise<TitleProfile | null> {
    const book = await this.fetchBook(slug, chain as InkChain | undefined);
    if (!book?.id) return null;
    return { year: book.year || undefined, authors: [], ids: idsInLinks((book.externalLinks ?? []).join(' ')) };
  }

  private searchBooks(query: string, chain: InkChain): Promise<InkstorySearchResult | null> {
    return this.fetch<InkstorySearchResult>(
      `${API_URL}/books?search=${encodeURIComponent(query)}&ignoreUserScopedContentStatus=true&serviceName=${SERVICES[chain]}`
    );
  }

  private fetchBook(slug: string, chain: InkChain = chainOfTitle(slug)): Promise<InkstorySearchItem | null> {
    return this.fetch<InkstorySearchItem>(`${API_URL}/books/${slug}`, {
      headers: { 'x-service-name': SERVICES[chain] },
    });
  }

  private async fetchChapters(slug: string): Promise<InkstoryChapter[] | null> {
    const book = await this.fetchBook(slug);
    if (!book?.id) return null;
    const chapters = await this.fetch<InkstoryChapter[]>(`${API_URL}/chapters?bookId=${book.id}`);
    return Array.isArray(chapters) ? chapters : null;
  }

  async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const [chapters, html] = await Promise.all([
      this.fetchChapters(slug),
      this.fetch<string>(`${currentHost(SITE_POOLS[chainOfTitle(slug)])}/content/${slug}`, {
        withCredentials: true,
      } as RequestInit),
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
    const book = await this.fetchBook(slug);
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
  async searchByQuery(query: string): Promise<QueryItem[] | null> {
    const found = await Promise.all(
      CHAIN_ORDER.map(async (chain) => ({ chain, books: await this.searchBooks(query, chain) }))
    );
    if (found.every(({ books }) => !books)) return null;

    return found.flatMap(({ chain, books }): QueryItem[] => {
      if (!books) return [{ failedGroup: GROUPS[chain] }];
      if (!Array.isArray(books)) return [];
      return books.map((item) => ({
        title: item.name?.ru || item.name?.en || Object.values(item.name || {})[0] || item.slug || '',
        slug: item.slug || '',
        image: item.poster || undefined,
        chain,
        group: GROUPS[chain],
      }));
    });
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
