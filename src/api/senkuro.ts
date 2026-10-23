/**
 * Senkuro API — GraphQL: title matching by a persisted search hash, popup search and titles by plain queries
 */

import { BasePlatformAPI, type QueryResult } from './base';
import { chainOfApplication, type SenkuroChain } from './senkuroChain';
import { Logger } from '@/src/utils/logger';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch } from '@/src/utils/manga';
import { currentHost, setTitleChain, titleChain } from '@/src/utils/mirrors';
import type { HostPool } from '@/src/utils/hostPool';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

/** One API for the whole ecosystem: any host finds and serves every title. */
const API_POOL: HostPool = {
  id: 'senkuro:api',
  hosts: ['https://api.senkuro.me', 'https://api.senkuro.com', 'https://api.senkognito.com'],
};

const SITE_POOLS: Record<SenkuroChain, HostPool> = {
  manga: { id: 'senkuro:manga', hosts: ['https://senkuro.me', 'https://senkuro.com'] },
  hentai: { id: 'senkuro:hentai', hosts: ['https://ne.senkognito.com', 'https://senkognito.com'] },
};

const persisted = (operationName: string, variables: object, sha256Hash: string) => ({
  operationName,
  variables,
  extensions: { persistedQuery: { version: 1, sha256Hash } },
});

const SEARCH_QUERY_HASH = 'e64937b4fc9c921c2141f2995473161bed921c75855c5de934752392175936bc';

/**
 * A plain query, not a persisted hash: the persisted document never selected
 * `applicationId`, and a newer hash would follow the site's deploys.
 */
const MANGA_QUERY = `query($slug: String!) { manga(slug: $slug) {
  slug applicationId chapters
  alternativeNames { content }
  branches { primaryTeamActivities { ranges { end } } }
  viewerBookmark { number }
} }`;

/** Search is shared by Senkuro and Senkognito and answers 10 by default; Senkognito titles often rank below that. */
const POPUP_SEARCH_QUERY = `query($query: String!) { search(query: $query, type: MANGA, first: 50) { edges { node { ... on SearchManga {
  slug applicationId originalName
  titles { lang content }
  cover { preview: resize(width: 175, height: 250) { url } }
} } } } }`;

interface SenkuroSearchNode {
  slug?: string;
  originalName?: string;
  titles?: Array<{ lang: string; content: string }>;
  applicationId?: string | number;
  cover?: { preview?: { url?: string } } | null;
}

interface SenkuroSearchResponse {
  data?: {
    search?: {
      edges?: Array<{ node?: SenkuroSearchNode }>;
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
      applicationId?: string;
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

  protected apiPool = API_POOL;
  protected sitePools = SITE_POOLS;

  link(slug: string, chain?: string): string {
    const pool = SITE_POOLS[(chain ?? titleChain('senkuro', slug)) as SenkuroChain] ?? SITE_POOLS.manga;
    return `${currentHost(pool)}/manga/${slug}/chapters`;
  }

  private async graphql<T>(body: object, withToken = false): Promise<T | null> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = withToken ? await this.getToken() : null;
    if (token) headers.authorization = `Bearer ${token}`;
    return this.fetchPool<T>(API_POOL, '/graphql', { method: 'POST', headers, body: JSON.stringify(body) });
  }

  /** Every fetched title tells its chain, so links follow it without another search. */
  private fetchManga(slug: string) {
    return this.shared(`manga:${slug}`, async () => {
      const response = await this.graphql<SenkuroMangaResponse>(
        { query: MANGA_QUERY, variables: { slug } },
        true
      );
      const manga = response?.data?.manga;
      if (!manga) {
        if (response) this.failedFetches++;
        return null;
      }
      const chain = chainOfApplication(manga.applicationId);
      await setTitleChain('senkuro', slug, chain);
      this.probeSiteHost(SITE_POOLS[chain]);
      return manga;
    });
  }

  getSlugFromURL(url: string): string | null {
    return parseSlugFromUrl(
      url,
      ['senkuro.me', 'senkuro.com', 'senkognito.com'],
      /^\/manga\/([^/?#]+)/
    );
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
        await this.cacheResult(matchedSlug, mangaData.chapter, mangaData.lastChapterRead);
        return this.prepareResponse(matchedSlug, mangaData.chapter, mangaData.lastChapterRead);
      }
    }

    if (signal?.aborted) return null;

    // Verify candidates via getManga (checks alternativeNames) - only when no exact match
    for (const entitySlug of candidates) {
      if (signal?.aborted) return null;

      const mangaData = await this.getMangaData(entitySlug);
      if (!mangaData) continue;

      Logger.debug(this.config.key, 'Checking alternativeNames', {
        entitySlug,
        alternativeNames: mangaData.alternativeNames?.map(n => n.content),
        titles,
      });

      // Check if any alternativeNames match our titles
      const hasMatch = titlesMatch(
        mangaData.alternativeNames?.map((name) => name.content) ?? [],
        titles
      );

      if (hasMatch) {
        Logger.debug(this.config.key, 'Match found in alternativeNames', entitySlug);
        await this.cacheResult(entitySlug, mangaData.chapter, mangaData.lastChapterRead);
        return this.prepareResponse(entitySlug, mangaData.chapter, mangaData.lastChapterRead);
      }
    }

    if (signal?.aborted) return null;

    Logger.debug(this.config.key, 'No match found');
    return null;
  }

  /**
   * Search by single title - returns slug and all candidates
   */
  private async searchByTitle(
    title: string,
    allTitles: string[]
  ): Promise<{ slug: string | null; candidates: string[] }> {
    const response = await this.graphql<SenkuroSearchResponse>(
      persisted('search', { query: title, type: 'MANGA' }, SEARCH_QUERY_HASH)
    );

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

      return titlesMatch(entityTitles, allTitles);
    });

    return {
      slug: matchedEntity?.node?.slug ?? null,
      candidates,
    };
  }

  /**
   * Get manga progress + alternativeNames (for title matching).
   */
  private async getMangaData(slug: string): Promise<{
    chapter: number;
    lastChapterRead: number;
    alternativeNames?: Array<{ content?: string }>;
  } | null> {
    const manga = await this.fetchManga(slug);
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
    const manga = await this.fetchManga(slug);
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
  async searchByQuery(query: string): Promise<QueryResult[] | null> {
    const response = await this.graphql<SenkuroSearchResponse>({ query: POPUP_SEARCH_QUERY, variables: { query } });
    // A rejected query answers with errors and no data: a failure, not "nothing found".
    const edges = response?.data?.search?.edges;
    if (!edges) return null;

    const results = edges.flatMap(({ node }) => {
      if (!node?.slug) return [];
      const chain = chainOfApplication(node.applicationId);
      const titles = node.titles || [];
      return [{
        title: titles.find((t) => t.lang === 'RU')?.content ||
          titles.find((t) => t.lang === 'EN')?.content ||
          titles[0]?.content ||
          node.originalName ||
          node.slug,
        slug: node.slug,
        image: node.cover?.preview?.url || undefined,
        chain,
        group: chain === 'hentai' ? 'Senkognito' : 'Senkuro',
      }];
    });
    new Set(results.map((r) => r.chain)).forEach((chain) => this.probeSiteHost(SITE_POOLS[chain]));
    return results;
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
