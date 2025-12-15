/**
 * Senkuro API
 * Uses GraphQL with persisted queries
 */

import { BasePlatformAPI } from './base';
import { Logger } from '@/src/utils/logger';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const GRAPHQL_URL = 'https://api.senkuro.me/graphql';

// Persisted query hashes
const QUERY_HASHES = {
  search: 'e64937b4fc9c921c2141f2995473161bed921c75855c5de934752392175936bc',
  manga: '6d8b28abb9a9ee3199f6553d8f0a61c005da8f5c56a88ebcf3778eff28d45bd5',
};

/**
 * Senkuro GraphQL Search Response DTO
 * POST /graphql with operationName: 'search'
 */
interface SenkuroSearchNode {
  id: string;
  slug: string;
  originalName: string;
  titles: Array<{
    lang: string;
    content: string;
    __typename: string;
  }>;
  mangaType: string;
  mangaStatus: string;
  mangaRating: string;
  translitionStatus: string;
  cover: {
    id: string;
    blurhash: string;
    original: {
      height: number;
      width: number;
      url: string;
      __typename: string;
    };
    preview: {
      url: string; // https://shiro.senkuro.net/... (175x250 resized)
      __typename: string;
    };
    __typename: string;
  } | null;
  __typename: string;
}

interface SenkuroSearchResponse {
  data?: {
    search?: {
      edges?: Array<{
        node?: SenkuroSearchNode;
        __typename?: string;
      }>;
      __typename?: string;
    };
  };
}

interface SenkuroMangaResponse {
  data?: {
    manga?: {
      slug?: string;
      name?: string;
      chapters?: number;
      alternativeNames?: Array<{ content?: string }>;
      branches?: Array<{
        primaryTeamActivities?: Array<{
          ranges?: Array<{
            end?: number;
          }>;
        }>;
      }>;
      viewerBookmark?: {
        number?: string | number;
      };
      [key: string]: unknown;
    };
  };
}

export class SenkuroAPI extends BasePlatformAPI {
  readonly config: PlatformConfig = {
    key: 'senkuro',
    domain: 'senkuro.me',
    title: 'Senkuro',
  };

  link(slug: string): string {
    return `https://senkuro.me/manga/${slug}/chapters`;
  }

  getSlugFromURL(url: string): string | null {
    // https://senkuro.me/manga/slug or /manga/slug/...
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
    if (signal?.aborted) return null;

    Logger.debug(this.config.key, 'Search started', { titles });

    // Try searching with each title until we get results
    let matchedSlug: string | null = null;
    let candidates: string[] = [];

    for (const title of titles) {
      if (signal?.aborted) return null;

      const result = await this.searchByTitle(title, titles);
      Logger.debug(this.config.key, 'Search result for title', { title, result });

      if (result.slug) {
        matchedSlug = result.slug;
        candidates = result.candidates;
        break;
      }
      if (result.candidates.length > 0 && candidates.length === 0) {
        candidates = result.candidates;
      }
    }

    Logger.debug(this.config.key, 'Final search results', { matchedSlug, candidates });

    if (signal?.aborted) return null;

    // If exact match found in search, use it directly (already verified by searchByTitle)
    if (matchedSlug) {
      const mangaData = await this.getMangaData(matchedSlug);
      if (mangaData) {
        Logger.debug(this.config.key, 'Using exact match', matchedSlug);
        await this.saveAutoMapping(sourcePlatform, sourceSlug, matchedSlug);
        await this.cacheResult(matchedSlug, mangaData.chapter, mangaData.lastChapterRead);
        return this.prepareResponse(matchedSlug, mangaData.chapter, mangaData.lastChapterRead);
      }
    }

    if (signal?.aborted) return null;

    // Verify candidates via getManga (checks alternativeNames) - only when no exact match
    for (const entitySlug of candidates) {
      if (signal?.aborted) return null;

      const mangaData = await this.getMangaDataWithManga(entitySlug);
      if (!mangaData) continue;

      Logger.debug(this.config.key, 'Checking alternativeNames', {
        entitySlug,
        alternativeNames: mangaData.alternativeNames?.map(n => n.content),
        titles,
      });

      // Check if any alternativeNames match our titles
      const hasMatch = mangaData.alternativeNames?.some((name) =>
        titles.includes(name.content ?? '')
      );

      if (hasMatch) {
        Logger.debug(this.config.key, 'Match found in alternativeNames', entitySlug);
        await this.saveAutoMapping(sourcePlatform, sourceSlug, entitySlug);
        await this.cacheResult(entitySlug, mangaData.chapter, mangaData.lastChapterRead);
        return this.prepareResponse(entitySlug, mangaData.chapter, mangaData.lastChapterRead);
      }
    }

    if (signal?.aborted) return null;

    Logger.debug(this.config.key, 'No match found');

    // No results - save negative mapping to prevent re-search
    await this.saveAutoMapping(sourcePlatform, sourceSlug, false);
    return null;
  }

  /**
   * Search by single title - returns slug and all candidates
   */
  private async searchByTitle(
    title: string,
    allTitles: string[]
  ): Promise<{ slug: string | null; candidates: string[] }> {
    const body = {
      operationName: 'search',
      variables: { query: title, type: 'MANGA' },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: QUERY_HASHES.search,
        },
      },
    };

    const response = await this.fetch<SenkuroSearchResponse>(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const edges = response?.data?.search?.edges;
    if (!edges?.length) return { slug: null, candidates: [] };

    // Collect all candidate slugs first (before matching)
    const candidates: string[] = edges
      .map((e) => e.node?.slug)
      .filter((s): s is string => Boolean(s));

    // Try to find exact title match
    const matchedEntity = edges.find((entity) => {
      const node = entity.node;
      if (!node?.slug) return false;

      const entityTitles = [
        node.originalName,  // Direct string from search response
        ...(node.titles?.map((t) => t.content) ?? []),
      ].filter(Boolean) as string[];

      return entityTitles.some((t) => allTitles.includes(t));
    });

    return {
      slug: matchedEntity?.node?.slug ?? null,
      candidates,
    };
  }

  /**
   * Get manga with progress data
   */
  private async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const result = await this.getMangaDataWithManga(slug);
    if (!result) return null;
    return { chapter: result.chapter, lastChapterRead: result.lastChapterRead };
  }

  /**
   * Get manga with progress data + alternativeNames for title matching
   */
  private async getMangaDataWithManga(slug: string): Promise<{
    chapter: number;
    lastChapterRead: number;
    alternativeNames?: Array<{ content?: string }>;
  } | null> {
    const token = await this.getToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }

    const body = {
      operationName: 'fetchManga',
      variables: { slug },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: QUERY_HASHES.manga,
        },
      },
    };

    const response = await this.fetch<SenkuroMangaResponse>(GRAPHQL_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const manga = response?.data?.manga;
    if (!manga) return null;

    // Calculate max chapter from branches
    const branchChapters = manga.branches
      ?.flatMap((branch) =>
        branch.primaryTeamActivities?.[0]?.ranges?.map((range) => range.end) ?? []
      )
      .filter((n): n is number => n !== undefined) ?? [];

    const maxChapter = branchChapters.length > 0
      ? Math.max(...branchChapters)
      : (manga.chapters ?? 0);

    // Get last read chapter
    // API returns number as string, need to parse
    const lastChapterRead = manga.viewerBookmark?.number
      ? parseInt(String(manga.viewerBookmark.number), 10)
      : 0;

    return {
      chapter: maxChapter,
      lastChapterRead: lastChapterRead > maxChapter ? maxChapter : lastChapterRead,
      alternativeNames: manga.alternativeNames,
    };
  }

  /**
   * Get manga metadata
   */
  async getManga(slug: string): Promise<Manga | null> {
    const token = await this.getToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }

    const body = {
      operationName: 'fetchManga',
      variables: { slug },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: QUERY_HASHES.manga,
        },
      },
    };

    const response = await this.fetch<SenkuroMangaResponse>(GRAPHQL_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const manga = response?.data?.manga;
    if (!manga) return null;

    return {
      slug: manga.slug,
      name: manga.name || slug,
      otherNames: manga.alternativeNames?.map((n) => n.content).filter(Boolean) as string[],
    };
  }

  /**
   * Get chapters list
   * Note: Senkuro's GraphQL returns chapter ranges, not individual chapters
   */
  async getChapters(slug: string): Promise<ChaptersResponse | null> {
    const data = await this.getMangaData(slug);
    if (!data) return null;

    // Return synthetic chapters list based on max chapter
    const chapters = Array.from({ length: data.chapter }, (_, i) => ({
      number: i + 1,
    }));

    return { data: chapters };
  }

  /**
   * Get user's bookmark/progress
   */
  async getBookmark(slug: string): Promise<Bookmark | null> {
    const data = await this.getMangaData(slug);
    if (!data) return null;

    return {
      chapter: data.lastChapterRead,
      lastChapterRead: data.lastChapterRead,
    };
  }

  /**
   * Simple search by query - for popup use
   */
  async searchByQuery(query: string): Promise<Array<{ title: string; slug: string; image?: string }>> {
    const body = {
      operationName: 'search',
      variables: { query, type: 'MANGA' },
      extensions: {
        persistedQuery: { version: 1, sha256Hash: QUERY_HASHES.search },
      },
    };

    const response = await this.fetch<SenkuroSearchResponse>(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const edges = response?.data?.search?.edges;
    if (!edges?.length) return [];

    return edges.slice(0, 5).map((e) => {
      const node = e.node;
      const titles = node?.titles || [];
      const title = titles.find((t) => t.lang === 'RU')?.content ||
        titles.find((t) => t.lang === 'EN')?.content ||
        titles[0]?.content ||
        node?.originalName ||
        node?.slug || '';
      return {
        title,
        slug: node?.slug || '',
        image: node?.cover?.preview?.url || undefined,
      };
    });
  }

  /**
   * Get cached or fresh data
   */
  async getData(slug: string): Promise<SearchResult | null> {
    // Check cache first
    const cached = await this.getCached(slug);
    if (cached) {
      Logger.debug(this.config.key, 'Using cached data', slug);
      return this.prepareResponse(slug, cached.chapter, cached.lastChapterRead);
    }

    // Fetch fresh data
    const data = await this.getMangaData(slug);
    if (!data) return null;

    // Cache result
    await this.cacheResult(slug, data.chapter, data.lastChapterRead);

    return this.prepareResponse(slug, data.chapter, data.lastChapterRead);
  }
}

// Export singleton instance
export const senkuroAPI = new SenkuroAPI();
