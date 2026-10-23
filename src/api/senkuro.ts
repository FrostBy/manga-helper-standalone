/**
 * Senkuro API — GraphQL: title matching by a persisted search hash, popup search and titles by plain queries
 */

import { BasePlatformAPI, type Candidate, type QueryResult } from './base';
import { chainOfApplication, type SenkuroChain } from './senkuroChain';
import { Logger } from '@/src/utils/logger';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch } from '@/src/utils/manga';
import { yearIn, type TitleProfile } from '@/src/utils/matchScore';
import { currentHost, setTitleChain, titleChain } from '@/src/utils/mirrors';
import type { HostPool } from '@/src/utils/hostPool';
import type { PlatformConfig, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

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
const HITS_TTL = 60 * 1000;

/**
 * A plain query, not a persisted hash: the persisted document never selected
 * `applicationId`, and a newer hash would follow the site's deploys.
 */
const MANGA_QUERY = `query($slug: String!) { manga(slug: $slug) {
  slug applicationId chapters malId releasedOn
  mainStaff { person { name } }
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
      malId?: number | null;
      releasedOn?: string | null;
      mainStaff?: Array<{ person?: { name?: string } | null }>;
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

  /** Exact name matches of one query; the hits stay for the alt-name pass. */
  protected async candidatesFor(query: string, titles: string[]): Promise<Candidate[] | null> {
    const edges = await this.searchHits(query);
    if (!edges) return null;
    return edges
      .filter(({ node }) => node?.slug && titlesMatch([node.originalName, ...(node.titles?.map((t) => t.content) ?? [])], titles))
      .map(({ node }) => ({ slug: node!.slug! }));
  }

  /** Search payloads lack alt names: the first non-empty hit list is checked title by title. */
  protected async fallbackCandidates(titles: string[], signal?: AbortSignal): Promise<Candidate[]> {
    for (const title of titles) {
      const slugs = ((await this.searchHits(title)) ?? []).map(({ node }) => node?.slug).filter((s): s is string => !!s);
      if (slugs.length === 0) continue;
      const matched: Candidate[] = [];
      for (const slug of slugs) {
        if (signal?.aborted) return [];
        const manga = await this.fetchManga(slug);
        if (manga && titlesMatch(manga.alternativeNames?.map((n) => n.content) ?? [], titles)) matched.push({ slug });
      }
      return matched;
    }
    return [];
  }

  private hits = new Map<string, { at: number; hits: Promise<Array<{ node?: SenkuroSearchNode }> | null> }>();

  /** The alt-name pass reads the hit lists the queries just got — for a minute, not the tab's life: the catalog grows. */
  private searchHits(query: string): Promise<Array<{ node?: SenkuroSearchNode }> | null> {
    const known = this.hits.get(query);
    if (known && Date.now() - known.at < HITS_TTL) return known.hits;
    const hits = this.graphql<SenkuroSearchResponse>(persisted('search', { query, type: 'MANGA' }, SEARCH_QUERY_HASH)).then(
      (response) => {
        if (!response) return null;
        const edges = response.data?.search?.edges;
        // A rejected query (a stale persisted hash) answers with errors and no data: a failure, not "nothing found".
        if (!edges) {
          this.failedFetches++;
          return null;
        }
        return edges;
      }
    );
    this.hits.set(query, { at: Date.now(), hits });
    hits.then(
      (found) => found || this.hits.delete(query),
      () => this.hits.delete(query)
    );
    return hits;
  }

  async getProfile(slug: string): Promise<TitleProfile | null> {
    const manga = await this.fetchManga(slug);
    if (!manga) return null;
    return {
      year: yearIn(manga.releasedOn),
      authors: (manga.mainStaff ?? []).map((staff) => staff.person?.name ?? '').filter(Boolean),
      ids: { mal: manga.malId ? String(manga.malId) : undefined },
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
