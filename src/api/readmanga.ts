/**
 * ReadManga API (a.zazaza.me)
 * Uses REST API + HTML parsing
 */

import { BasePlatformAPI } from './base';
import { readingStats, type ChapterRow } from './readmangaChapters';
import { Logger } from '@/src/utils/logger';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch } from '@/src/utils/manga';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const BASE_URL = 'https://a.zazaza.me';

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

/**
 * Suggestions span the whole federation; other sites' entries carry absolute
 * links (seimanga, mintmanga) that are no slug here and 404 as one.
 */
const isOwnSuggestion = (s: ReadMangaSearchSuggestion): boolean => s.link?.startsWith('/') ?? false;

interface ServerVariables {
  siteId?: string;
  serverUrl?: string;
  serverApiUrl?: string;
  xUrl?: string;
  xApiUrl?: string;
}

export class ReadMangaAPI extends BasePlatformAPI {
  readonly config: PlatformConfig = {
    key: 'readmanga',
    domain: 'a.zazaza.me',
    title: 'ReadManga',
  };

  link(slug: string): string {
    return `${BASE_URL}/${slug}#chapters-list`;
  }

  getSlugFromURL(url: string): string | null {
    return parseSlugFromUrl(url, ['zazaza.me', 'readmanga.io', 'mintmanga.com'], /^\/([^/?#]+)/);
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
    const url = new URL(`${BASE_URL}/search/suggestion`);
    url.searchParams.set('query', title);
    url.searchParams.append('types[]', 'CREATION');
    url.searchParams.append('types[]', 'FEDERATION_MANGA');

    const response = await this.fetch<ReadMangaSearchResult>(url.toString());

    const suggestions = response?.suggestions;
    if (!suggestions?.length) return null;

    const matched = suggestions.filter(isOwnSuggestion).find((s) =>
      titlesMatch([s.value, ...(s.names ?? [])], allTitles)
    );

    // Extract slug from link (e.g. "/slug" -> "slug")
    const link = matched?.link;
    return link ? link.replace('/', '') : null;
  }

  private parseChapterRows(doc: Document): ChapterRow[] {
    return [...doc.querySelectorAll('#chapters-list tr.item-row[data-num]')].map((tr) => ({
      vol: Number(tr.getAttribute('data-vol')),
      num: Number(tr.getAttribute('data-num')),
    }));
  }

  private async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const html = await this.fetch<string>(`${BASE_URL}/${slug}#chapters-list`);
    if (!html || typeof html !== 'string') return null;

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
    const url = `${BASE_URL}/${slug}`;
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
  async searchByQuery(query: string): Promise<Array<{ title: string; slug: string; image?: string }> | null> {
    const url = new URL(`${BASE_URL}/search/suggestion`);
    url.searchParams.set('query', query);
    url.searchParams.append('types[]', 'CREATION');
    url.searchParams.append('types[]', 'FEDERATION_MANGA');

    const response = await this.fetch<ReadMangaSearchResult>(url.toString());
    if (!response) return null;

    return (response.suggestions ?? []).filter(isOwnSuggestion).slice(0, 5).map((s) => ({
      title: s.value || '',
      slug: s.link?.replace(/^\//, '') || '',
      image: s.thumbnail || undefined,
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
export const readmangaAPI = new ReadMangaAPI();
