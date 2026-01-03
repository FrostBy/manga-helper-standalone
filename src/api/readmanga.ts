/**
 * ReadManga API (a.zazaza.me)
 * Uses REST API + HTML parsing
 */

import { BasePlatformAPI } from './base';
import { Logger } from '@/src/utils/logger';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const BASE_URL = 'https://a.zazaza.me';

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
  readonly config: PlatformConfig = {
    key: 'readmanga',
    domain: 'a.zazaza.me',
    title: 'ReadManga',
  };

  link(slug: string): string {
    return `${BASE_URL}/${slug}#chapters-list`;
  }

  getSlugFromURL(url: string): string | null {
    // https://a.zazaza.me/slug
    const match = url.match(/zazaza\.me\/([^/?#]+)/);
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
    const url = new URL(`${BASE_URL}/search/suggestion`);
    url.searchParams.set('query', title);
    url.searchParams.append('types[]', 'CREATION');
    url.searchParams.append('types[]', 'FEDERATION_MANGA');

    const response = await this.fetch<ReadMangaSearchResult>(url.toString());

    const suggestions = response?.suggestions;
    if (!suggestions?.length) return null;

    // Find matching suggestion by value or names
    const matched = suggestions.find((s) =>
      [s.value, ...(s.names ?? [])].includes(title)
    );

    // Extract slug from link (e.g. "/slug" -> "slug")
    const link = matched?.link;
    return link ? link.replace('/', '') : null;
  }

  /**
   * Get manga data by parsing HTML
   * Chapter value is stored * 10, so we divide by 10
   */
  private async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const url = `${BASE_URL}/${slug}#chapters-list`;
    const html = await this.fetch<string>(url);

    if (!html || typeof html !== 'string') return null;

    try {
      // Parse data-num from first item-title td inside #chapters-list
      const chaptersListStart = html.indexOf('id="chapters-list"');
      let rawChapter = 0;

      if (chaptersListStart !== -1) {
        const afterChaptersList = html.slice(chaptersListStart);
        // Find first data-num in item-title td (attributes can be in any order)
        const dataNumMatch = afterChaptersList.match(/<td[^>]*class="[^"]*item-title[^"]*"[^>]*data-num="(\d+)"/)
          || afterChaptersList.match(/<td[^>]*data-num="(\d+)"[^>]*class="[^"]*item-title[^"]*"/);
        rawChapter = dataNumMatch ? parseInt(dataNumMatch[1], 10) : 0;
      }

      // ReadManga stores chapters * 10
      const chapter = rawChapter / 10;

      // Try to get reading progress
      let lastChapterRead = 0;

      // First try API with token
      const token = await this.getToken();
      if (token) {
        const bookmarkResult = await this.fetchBookmark(html, token);
        if (bookmarkResult) {
          lastChapterRead = bookmarkResult / 10;
        }
      }

      // Fallback: parse visited chapters from HTML (chapter-status item-visited class)
      if (lastChapterRead === 0) {
        lastChapterRead = this.parseVisitedChapters(html);
      }

      return { chapter, lastChapterRead };
    } catch (error) {
      Logger.error(this.config.key, 'Failed to parse manga page', error);
      return null;
    }
  }

  /**
   * Parse visited chapters from HTML by looking for item-visited class
   * Returns the highest visited chapter number / 10
   */
  private parseVisitedChapters(html: string): number {
    // Find all data-num values in rows with item-visited class
    // Pattern: <tr class="...item-visited...">...<td ... data-num="123">
    const visitedMatches = html.matchAll(/<tr[^>]*class="[^"]*item-visited[^"]*"[^>]*>[\s\S]*?<td[^>]*data-num="(\d+)"/g);

    let maxVisited = 0;
    for (const match of visitedMatches) {
      const num = parseInt(match[1], 10);
      if (num > maxVisited) {
        maxVisited = num;
      }
    }

    return maxVisited / 10;
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
   * Fetch bookmark progress from API
   */
  private async fetchBookmark(html: string, token: string): Promise<number | null> {
    try {
      const variables = this.extractServerVariables(html);
      if (!variables.xApiUrl) return null;

      // Parse externalId and type from #chapters-list
      const externalIdMatch = html.match(/id="chapters-list"[^>]*data-id="(\d+)"/);
      const typeMatch = html.match(/id="chapters-list"[^>]*data-type="([^"]+)"/);

      if (!externalIdMatch || !typeMatch || !variables.siteId) return null;

      const externalId = externalIdMatch[1];
      const type = typeMatch[1];

      // Build multipart form data
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
      const formBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="siteId"',
        '',
        variables.siteId,
        `--${boundary}`,
        'Content-Disposition: form-data; name="type"',
        '',
        type,
        `--${boundary}`,
        'Content-Disposition: form-data; name="externalId"',
        '',
        externalId,
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const requestUrl = `${variables.xApiUrl}/api/bookmark/progress`;

      const response = await this.fetch<{ progress?: { num?: number } }>(
        requestUrl,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': `multipart/form-data; boundary=${boundary}`,
          },
          body: formBody,
        }
      );

      return response?.progress?.num ?? null;
    } catch (error) {
      Logger.warn(this.config.key, 'Failed to fetch bookmark', error);
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

      // h1.names > .name - main title
      const mainName = doc.querySelector('h1.names > .name');
      const name = mainName?.textContent?.trim();
      if (!name) return null;

      const otherNames: string[] = [];

      // h1.names .eng-name - english title
      const engName = doc.querySelector('h1.names .eng-name');
      if (engName?.textContent) otherNames.push(engName.textContent.trim());

      // h1.names .original-name - original title
      const origName = doc.querySelector('h1.names .original-name');
      if (origName?.textContent) otherNames.push(origName.textContent.trim());

      // .all-names-popover .name - all alternative names from popover
      const popoverNames = doc.querySelectorAll('.all-names-popover .name');
      popoverNames.forEach((el) => {
        if (el.textContent) otherNames.push(el.textContent.trim());
      });

      // .another-names .expandable-text__text - alternative names separated by /
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

  /**
   * Get user's bookmark
   */
  async getBookmark(slug: string): Promise<Bookmark | null> {
    const token = await this.getToken();
    if (!token) return null;

    // Fetch page to get externalId and server variables
    const url = `${BASE_URL}/${slug}#chapters-list`;
    const html = await this.fetch<string>(url);

    if (!html || typeof html !== 'string') return null;

    const bookmarkNum = await this.fetchBookmark(html, token);
    if (bookmarkNum === null) return null;

    return {
      chapter: bookmarkNum / 10,
      lastChapterRead: bookmarkNum / 10,
    };
  }

  /**
   * Simple search by query - for popup use
   */
  async searchByQuery(query: string): Promise<Array<{ title: string; slug: string; image?: string }>> {
    const url = new URL(`${BASE_URL}/search/suggestion`);
    url.searchParams.set('query', query);
    url.searchParams.append('types[]', 'CREATION');
    url.searchParams.append('types[]', 'FEDERATION_MANGA');

    const response = await this.fetch<ReadMangaSearchResult>(url.toString());
    if (!response?.suggestions) return [];

    return response.suggestions.slice(0, 5).map((s) => ({
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
