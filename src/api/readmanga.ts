/**
 * ReadManga API (a.zazaza.me)
 * Uses REST API + HTML parsing
 */

import { storage } from '@wxt-dev/storage';
import { BasePlatformAPI } from './base';
import { Logger } from '@/src/utils/logger';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const BASE_URL = 'https://a.zazaza.me';

// API meta cached per slug — externalId is stable for life of the title;
// siteId / xApiUrl are platform constants but we still extract per page for safety.
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

const META_CACHE_KEY = 'local:readmanga-meta' as const;
const META_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
type MetaCacheEntry = ReadMangaMeta & { expires: number };
type MetaCache = Record<string, MetaCacheEntry>;

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

      const slug = await this.searchByTitle(title);
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
   * Parse total chapter count from HTML (data-num of first item-title td).
   * ReadManga stores chapters * 10 → /10 (no rounding).
   */
  private parseChapterCount(html: string): number {
    const chaptersListStart = html.indexOf('id="chapters-list"');
    if (chaptersListStart === -1) return 0;
    const afterChaptersList = html.slice(chaptersListStart);
    const dataNumMatch =
      afterChaptersList.match(/<td[^>]*class="[^"]*item-title[^"]*"[^>]*data-num="(\d+)"/) ||
      afterChaptersList.match(/<td[^>]*data-num="(\d+)"[^>]*class="[^"]*item-title[^"]*"/);
    const rawChapter = dataNumMatch ? parseInt(dataNumMatch[1], 10) : 0;
    return rawChapter / 10;
  }

  /**
   * Per-slug meta cache (30 days). Avoids re-fetching HTML when only progress
   * is needed on refresh.
   */
  private async getCachedMeta(slug: string): Promise<ReadMangaMeta | null> {
    const all = (await storage.getItem<MetaCache>(META_CACHE_KEY)) ?? {};
    const entry = all[slug];
    if (!entry || Date.now() > entry.expires) return null;
    const { expires, ...meta } = entry;
    void expires;
    return meta;
  }

  private async setCachedMeta(slug: string, meta: ReadMangaMeta): Promise<void> {
    try {
      const all = (await storage.getItem<MetaCache>(META_CACHE_KEY)) ?? {};
      all[slug] = { ...meta, expires: Date.now() + META_TTL_MS };
      await storage.setItem(META_CACHE_KEY, all);
    } catch (error) {
      Logger.warn(this.config.key, 'Failed to cache meta', error);
    }
  }

  /**
   * Get manga data with fast-path / slow-path:
   *  - Fast: if cached meta + cached chapter count exist AND have token,
   *    call API directly. No HTML fetch.
   *  - Slow: fetch HTML, parse chapter + meta, cache meta, try API,
   *    fall back to DOM `data-visited="true"` rows if API fails.
   */
  private async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const token = await this.getToken();
    const cachedMeta = await this.getCachedMeta(slug);
    const cachedResult = await this.getCached(slug);

    // Fast path — only progress needs refresh, everything else from cache.
    if (token && cachedMeta && cachedResult) {
      const raw = await this.fetchProgressDirect(cachedMeta, token);
      if (raw !== null) {
        Logger.debug(this.config.key, 'API-only refresh (no HTML)', { slug, raw });
        return { chapter: cachedResult.chapter, lastChapterRead: raw / 10 };
      }
      Logger.debug(this.config.key, 'API fast-path failed, falling back to HTML', { slug });
    }

    // Slow path — fetch full page.
    const html = await this.fetch<string>(`${BASE_URL}/${slug}#chapters-list`);
    if (!html || typeof html !== 'string') return null;

    try {
      const chapter = this.parseChapterCount(html);

      const meta = this.extractApiMeta(html);
      if (meta) await this.setCachedMeta(slug, meta);

      let lastChapterRead = 0;
      if (token && meta) {
        const raw = await this.fetchProgressDirect(meta, token);
        if (raw !== null) lastChapterRead = raw / 10;
      }

      // DOM fallback — works even without token (user reads while logged-out).
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
   * Parse visited chapters from HTML by looking at <tr data-visited="true">.
   * The class `item-visited` lives on the inner <i>, not on <tr> — the real
   * marker is the `data-visited="true"` attribute on the row itself.
   * Returns the highest visited chapter number / 10 (no rounding).
   */
  private parseVisitedChapters(html: string): number {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const visited = doc.querySelectorAll('tr[data-visited="true"]');
    let max = 0;
    visited.forEach((tr) => {
      const n = parseInt(tr.getAttribute('data-num') ?? '0', 10);
      if (n > max) max = n;
    });
    return max / 10;
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
   * POST progress API with already-extracted params (no HTML needed).
   * Returns raw `num` (still ×10 — caller divides). Tries `progress.num`
   * then falls back to `bookmark.num` so we don't lose data if API shape shifts.
   */
  private async fetchProgressDirect(meta: ReadMangaMeta, token: string): Promise<number | null> {
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
      return response?.progress?.num ?? response?.bookmark?.num ?? null;
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

  /**
   * Get user's bookmark — API-only when meta is cached; otherwise fetch HTML once.
   */
  async getBookmark(slug: string): Promise<Bookmark | null> {
    const token = await this.getToken();
    if (!token) return null;

    let meta = await this.getCachedMeta(slug);
    if (!meta) {
      const html = await this.fetch<string>(`${BASE_URL}/${slug}#chapters-list`);
      if (!html || typeof html !== 'string') return null;
      meta = this.extractApiMeta(html);
      if (!meta) return null;
      await this.setCachedMeta(slug, meta);
    }

    const raw = await this.fetchProgressDirect(meta, token);
    if (raw === null) return null;

    const value = raw / 10;
    return { chapter: value, lastChapterRead: value };
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
