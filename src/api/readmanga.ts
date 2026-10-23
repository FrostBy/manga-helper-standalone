/**
 * Grouple engine API — ReadManga with its sister sites (MintManga 18+, SeiManga),
 * and AllHentai, a separate network on the same engine.
 * Title pages are HTML; the bookmark comes from the API the page names (X_API_URL).
 */

import { BasePlatformAPI, type Candidate, type QueryItem } from './base';
import { readingStats, type ChapterRow } from './readmangaChapters';
import { Logger } from '@/src/utils/logger';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch } from '@/src/utils/manga';
import { idsInLinks, yearIn, type TitleProfile } from '@/src/utils/matchScore';
import { MAIN_CHAIN, currentHost, titleChain } from '@/src/utils/mirrors';
import type { HostPool } from '@/src/utils/hostPool';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

export interface GroupleNetwork {
  key: PlatformKey;
  title: string;
  /** Hosts whose links are this platform's titles, subdomains included. */
  domains: string[];
  /** Fallback hosts carry fewer titles: a title missing there is a failure, not "not found". */
  pools: Record<string, HostPool>;
  /** Auto-linking prefers the main catalog when a title is on several sites. */
  chainOrder: string[];
  groups: Record<string, string>;
}

const READMANGA: GroupleNetwork = {
  key: 'readmanga',
  title: 'ReadManga',
  domains: ['zazaza.me', 'readmanga.io', 'readmanga.me', 'mintmanga.com', 'mintmanga.one', 'seimanga.me'],
  pools: {
    manga: { id: 'readmanga:manga', hosts: ['https://a.zazaza.me', 'https://readmanga.me'] },
    hentai: { id: 'readmanga:hentai', hosts: ['https://2.mintmanga.one', 'https://1.mintmanga.com'] },
    seinen: { id: 'readmanga:seinen', hosts: ['https://1.seimanga.me'] },
  },
  chainOrder: ['manga', 'hentai', 'seinen'],
  groups: { manga: 'ReadManga', hentai: 'MintManga', seinen: 'SeiManga' },
};

/** A parked domain or a block page answers 200 too; every Grouple page declares its site. */
const isGrouplePage = (data: unknown): boolean => typeof data === 'string' && data.includes('RM_site_id');

interface ReadMangaMeta {
  externalId: string;
  type: string;
  siteId: string;
  xApiUrl: string;
}

interface ReadMangaProgressResponse {
  bookmark?: { num?: number | null; vol?: number | null } | null;
  progress?: { num?: number | null; vol?: number | null; times?: number | null } | null;
}

/**
 * ReadManga Search API Response DTO
 * GET /search/suggestion?query={query}&types[]=CREATION&types[]=FEDERATION_MANGA
 */
interface ReadMangaSearchSuggestion {
  value: string;
  elementId: {
    filled: boolean;
    type: string;
    siteId: number;
    federationUID: string;
    typeId: number;
    typeName: string;
    topicId: number;
    linkName: string;
    externalId: number;
  };
  link: string;
  thumbnail: string; // full URL: https://staticrm.rmr.rocks/uploads/pics/...
  additional: string | null;
  score: number | null;
  names: string[];
  pessimization: boolean;
}

interface ReadMangaSearchResult {
  query: string;
  suggestions: ReadMangaSearchSuggestion[];
}

interface ServerVariables {
  siteId?: string;
  serverUrl?: string;
  serverApiUrl?: string;
  xUrl?: string;
  xApiUrl?: string;
}

export class ReadMangaAPI extends BasePlatformAPI {
  readonly config: PlatformConfig;

  constructor(private readonly network: GroupleNetwork) {
    super();
    this.config = { key: network.key, domain: new URL(network.pools[MAIN_CHAIN].hosts[0]).host, title: network.title };
    this.sitePools = network.pools;
  }

  private chainOfTitle(slug: string): string {
    const chain = titleChain(this.config.key, slug);
    return chain in this.network.pools ? chain : MAIN_CHAIN;
  }

  /**
   * Suggestions span the whole federation: own titles have relative links, other
   * sites absolute ones. Sites we don't cover (SelfManga, LibreBook) are dropped —
   * their slug would 404 on every pool.
   */
  private titleOfSuggestion(s: ReadMangaSearchSuggestion): { slug: string; chain: string } | null {
    if (!s.link) return null;
    if (s.link.startsWith('/')) return { slug: s.link.slice(1), chain: MAIN_CHAIN };
    try {
      const { origin, pathname } = new URL(s.link);
      const chain = this.network.chainOrder.find((c) => this.network.pools[c].hosts.includes(origin));
      return chain ? { slug: pathname.slice(1), chain } : null;
    } catch {
      return null;
    }
  }

  link(slug: string, chain?: string): string {
    const pool = this.network.pools[chain ?? this.chainOfTitle(slug)] ?? this.network.pools[MAIN_CHAIN];
    return `${currentHost(pool)}/${slug}#chapters-list`;
  }

  getSlugFromURL(url: string): string | null {
    return parseSlugFromUrl(url, this.network.domains, /^\/([^/?#]+)/);
  }

  /** A fallback host carries fewer titles, so only the primary host's 404 means the title is gone. */
  async titleGone(slug: string): Promise<boolean> {
    const pool = this.network.pools[this.chainOfTitle(slug)] ?? this.network.pools[MAIN_CHAIN];
    const result = await this.request(`${pool.hosts[0]}/${slug}`);
    return !result.ok && result.status === 404;
  }

  /** Main catalog first on a tie: the same title often sits on a sister site too. */
  protected async candidatesFor(query: string, titles: string[]): Promise<Candidate[] | null> {
    const suggestions = await this.suggestions(query);
    if (!suggestions) return null;
    const rank = (chain: string) => this.network.chainOrder.indexOf(chain);
    return suggestions
      .flatMap((s) => {
        const found = this.titleOfSuggestion(s);
        return found && titlesMatch([s.value, ...(s.names ?? [])], titles) ? [found] : [];
      })
      .sort((a, b) => rank(a.chain) - rank(b.chain));
  }

  async getProfile(slug: string, chain?: string): Promise<TitleProfile | null> {
    const html = await this.fetchTitlePage(slug, chain);
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const authors = [...doc.querySelectorAll('.cr-main-person-item__name a[href^="/list/person/"]')]
      .map((a) => a.textContent?.trim() ?? '')
      .filter(Boolean);
    const year = yearIn(doc.querySelector('a[href^="/list/year/"]')?.textContent);
    return { year, authors, ids: idsInLinks(html) };
  }

  /** One search on the main site covers the sister sites too. */
  private async suggestions(query: string): Promise<ReadMangaSearchSuggestion[] | null> {
    const params = new URLSearchParams({ query });
    params.append('types[]', 'CREATION');
    params.append('types[]', 'FEDERATION_MANGA');
    const response = await this.fetchPool<ReadMangaSearchResult>(this.network.pools[MAIN_CHAIN], `/search/suggestion?${params}`);
    return response ? (response.suggestions ?? []) : null;
  }

  private parseChapterRows(doc: Document): ChapterRow[] {
    return [...doc.querySelectorAll('#chapters-list tr.item-row[data-num]')].map((tr) => ({
      vol: Number(tr.getAttribute('data-vol')),
      num: Number(tr.getAttribute('data-num')),
    }));
  }

  private fetchTitlePage(slug: string, chain = this.chainOfTitle(slug)): Promise<string | null> {
    const pool = this.network.pools[chain] ?? this.network.pools[MAIN_CHAIN];
    return this.fetchPool<string>(pool, `/${slug}`, undefined, { accept: isGrouplePage });
  }

  private async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const html = await this.fetchTitlePage(slug);
    if (!html) return null;

    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (!doc.querySelector('#chapters-list')) {
        // A title with no chapters yet has no list at all; only a page without
        // the title itself is a layout change or a block page.
        if (doc.querySelector('h1.cr-hero-names__main')) return { chapter: 0, lastChapterRead: 0 };
        throw new Error('#chapters-list not found');
      }
      const rows = this.parseChapterRows(doc);
      const token = await this.getToken();
      const meta = token ? this.extractApiMeta(html) : null;
      const bookmark = token && meta ? await this.fetchProgressDirect(meta, token) : null;
      return readingStats(rows, bookmark);
    } catch (error) {
      Logger.error(this.config.key, 'Failed to parse manga page', error);
      this.failedFetches++;
      return null;
    }
  }

  /**
   * Extract server variables from HTML
   */
  private extractServerVariables(html: string): ServerVariables {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Find script containing SERVER_URL (check head and body)
    const scripts = doc.querySelectorAll('script');
    let scriptText = '';
    for (const script of scripts) {
      if (script.textContent?.includes('SERVER_URL') || script.textContent?.includes('X_API_URL')) {
        scriptText = script.textContent;
        break;
      }
    }

    if (!scriptText) return {};

    // Parse var assignments
    const variables: Record<string, string> = {};
    const lines = scriptText.split('\n').filter((line) => line.trim().startsWith('var '));

    for (const line of lines) {
      const [left, right] = line.split('=');
      if (left && right) {
        const name = left.replace('var', '').trim();
        const value = right.replace(/[;'"]/g, '').trim();
        variables[name] = value;
      }
    }

    return {
      siteId: variables['RM_site_id'],
      serverUrl: variables['SERVER_URL'],
      serverApiUrl: variables['SERVER_API_URL'],
      xUrl: variables['X_URL'],
      xApiUrl: variables['X_API_URL'],
    };
  }

  /**
   * Extract API params from HTML page (externalId/type from #chapters-list,
   * siteId/xApiUrl from inline <script> vars).
   * Returns null if any param missing — page layout changed.
   */
  private extractApiMeta(html: string): ReadMangaMeta | null {
    const variables = this.extractServerVariables(html);
    if (!variables.xApiUrl || !variables.siteId) {
      Logger.warn(this.config.key, 'Missing X_API_URL / RM_site_id in page', variables);
      return null;
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const chaptersList = doc.querySelector('#chapters-list');
    if (!chaptersList) {
      Logger.warn(this.config.key, '#chapters-list not found in HTML');
      return null;
    }
    const externalId = chaptersList.getAttribute('data-id');
    const type = chaptersList.getAttribute('data-type');
    if (!externalId || !type) {
      Logger.warn(this.config.key, 'chapters-list missing data-id/data-type', { externalId, type });
      return null;
    }
    return { externalId, type, siteId: variables.siteId, xApiUrl: variables.xApiUrl };
  }

  /**
   * `num` stays ×10 like the page's `data-num`. Tries `progress` then
   * `bookmark` so we don't lose data if the API shape shifts.
   */
  private async fetchProgressDirect(
    meta: ReadMangaMeta,
    token: string
  ): Promise<{ vol: number; num: number } | null> {
    try {
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
      const formBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="siteId"',
        '',
        meta.siteId,
        `--${boundary}`,
        'Content-Disposition: form-data; name="type"',
        '',
        meta.type,
        `--${boundary}`,
        'Content-Disposition: form-data; name="externalId"',
        '',
        meta.externalId,
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const response = await this.fetch<ReadMangaProgressResponse>(
        `${meta.xApiUrl}/api/bookmark/progress`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': `multipart/form-data; boundary=${boundary}`,
          },
          body: formBody,
        }
      );

      Logger.debug(this.config.key, 'progress API response', response);
      const mark = response?.progress?.num != null ? response.progress : response?.bookmark;
      return mark?.num != null && mark.vol != null ? { vol: mark.vol, num: mark.num } : null;
    } catch (error) {
      Logger.warn(this.config.key, 'Failed to fetch progress', error);
      return null;
    }
  }

  /**
   * Get manga metadata (with fetch)
   */
  async getManga(slug: string): Promise<Manga | null> {
    const html = await this.fetchTitlePage(slug);
    return html ? this.parseMangaHTML(html) : null;
  }

  /**
   * Parse manga metadata from HTML (no fetch)
   */
  parseMangaHTML(html: string): Manga | null {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // New layout: h1.cr-hero-names__main, fallback to old: h1.names > .name
      const mainName = doc.querySelector('h1.cr-hero-names__main')
        ?? doc.querySelector('h1.names > .name');
      const name = mainName?.textContent?.trim();
      if (!name) return null;

      const otherNames: string[] = [];

      // New layout: h3.cr-hero-names__alt contains spans with titles separated by spans.cr-hero-names__alt-separator
      const altContainer = doc.querySelector('h3.cr-hero-names__alt > span');
      if (altContainer) {
        const spans = altContainer.querySelectorAll(':scope > span:not(.cr-hero-names__alt-separator)');
        spans.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) {
            // Last span may contain multiple names separated by /
            if (text.includes('/')) {
              otherNames.push(...text.split('/').map((s) => s.trim()).filter(Boolean));
            } else {
              otherNames.push(text);
            }
          }
        });
      }

      // Old layout fallbacks
      const engName = doc.querySelector('h1.names .eng-name');
      if (engName?.textContent) otherNames.push(engName.textContent.trim());

      const origName = doc.querySelector('h1.names .original-name');
      if (origName?.textContent) otherNames.push(origName.textContent.trim());

      const popoverNames = doc.querySelectorAll('.all-names-popover .name');
      popoverNames.forEach((el) => {
        if (el.textContent) otherNames.push(el.textContent.trim());
      });

      const altNamesEl = doc.querySelector('.another-names .expandable-text__text');
      if (altNamesEl?.textContent) {
        const altNames = altNamesEl.textContent.split('/').map((s) => s.trim()).filter(Boolean);
        otherNames.push(...altNames);
      }

      // Dedupe
      const uniqueOtherNames = [...new Set(otherNames)];

      return { name, otherNames: uniqueOtherNames };
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

    const chapters = Array.from({ length: Math.ceil(data.chapter) }, (_, i) => ({
      number: i + 1,
    }));

    return { data: chapters };
  }

  async getBookmark(slug: string): Promise<Bookmark | null> {
    const data = await this.getMangaData(slug);
    return data && { chapter: data.lastChapterRead, lastChapterRead: data.lastChapterRead };
  }

  /**
   * Simple search by query - for popup use
   */
  async searchByQuery(query: string): Promise<QueryItem[] | null> {
    const suggestions = await this.suggestions(query);
    if (!suggestions) return null;

    const results = suggestions.flatMap((s) => {
      const found = this.titleOfSuggestion(s);
      return found
        ? [{ title: s.value || '', slug: found.slug, image: s.thumbnail || undefined, chain: found.chain, group: this.network.groups[found.chain] }]
        : [];
    });
    new Set(results.map((r) => r.chain)).forEach((chain) => this.probeSiteHost(this.network.pools[chain]));
    return results;
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
export const readmangaAPI = new ReadMangaAPI(READMANGA);
