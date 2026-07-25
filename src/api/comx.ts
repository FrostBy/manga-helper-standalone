/**
 * com-x.life API
 *
 * DLE + Vue widget. There is no read-API: `mod=api&action=...` exposes only
 * mutations (bookmark/toggle, readed/toggleReaded, ...). Chapters AND user
 * progress both ship SSR inside a `window.__DATA__` inline script on the title
 * page, so we fetch the page and read that JSON.
 *
 * Site sits behind a JS anti-bot challenge: an unauthenticated fetch gets a
 * browser-check page instead of content. Requests go with credentials so the
 * browser attaches the challenge cookie earned when the user visits the site.
 */

import { BasePlatformAPI } from './base';
import { Logger } from '@/src/utils/logger';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const BASE_URL = 'https://com-x.life';

/**
 * Chapter entry from `__DATA__.chapters`.
 *
 * `posi` — cumulative ordinal across all volumes (1..N).
 * `number` — per-volume number: resets between volumes and may be 0 (prologue),
 * so it must never be used for counting. Observed live: last chapter of
 * "Как выжить в академии" is posi 115 / number 113.
 */
interface ComXChapter {
  id: number;
  posi: number;
  number: number;
  volume: number;
  title: string;
  pages: number;
  date: string;
  download_link: string;
}

/**
 * `window.__DATA__` payload.
 *
 * `readed` and `bookmark` are PHP assoc-arrays: they serialise to `{}`/`{...}`
 * when filled but to `[]` when empty, and `readed` may arrive either as a list
 * of ids or as a `{id: bool}` map (the site's own bulk-download.js documents
 * this quirk). `unreadedAll` sets `false` rather than dropping the key.
 */
interface ComXData {
  news_id: number;
  title: string;
  limit?: number;
  chapters?: ComXChapter[];
  readed?: number[] | Record<string, boolean>;
  bookmark?: { chapter_id?: number } | unknown[];
}

/**
 * `window.__DATA__` on the reader page (/reader/{news_id}/{chapter_id}).
 * `next`/`prev` are ready-to-use relative chapter URLs, empty on the last/first
 * chapter. `post_link` points back at the title page — the only way to recover
 * the slug here, since the reader URL carries just a numeric news_id.
 */
export interface ComXReaderData {
  news_id: number;
  chapter_id: number;
  next?: string;
  prev?: string;
  post_link?: string;
  auto_vertical?: boolean;
}

/**
 * Extract a balanced JSON object from `src` starting at `start` (an index
 * pointing at `{`). String-aware, so braces inside titles don't end it early.
 */
function sliceBalancedJson(src: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < src.length; i++) {
    const char = src[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }

  return null;
}

/** Normalise `readed` (list of ids | {id: bool} map) to a list of read ids. */
function normalizeReaded(raw: ComXData['readed']): number[] {
  if (!raw) return [];

  const ids = Array.isArray(raw)
    ? raw.map(Number)
    : Object.entries(raw)
        .filter(([, isRead]) => isRead)
        .map(([id]) => Number(id));

  return ids.filter((id) => Number.isFinite(id) && id > 0);
}

export class ComXAPI extends BasePlatformAPI {
  readonly config: PlatformConfig = {
    key: 'comx',
    domain: 'com-x.life',
    title: 'Com-x',
  };

  link(slug: string): string {
    return `${BASE_URL}/${slug}.html#chapters`;
  }

  getSlugFromURL(url: string): string | null {
    return parseSlugFromUrl(url, ['com-x.life'], /^\/(\d+-[^/?#]+)\.html/);
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
   * DLE search — returns HTML, no JSON endpoint exists.
   * Accepts a hit only when a title matches exactly, since DLE returns loose
   * full-text matches (searching one title yields ~30 unrelated results).
   */
  private async searchByTitle(title: string): Promise<string | null> {
    const html = await this.fetchPage(`${BASE_URL}/index.php?do=search`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        do: 'search',
        subaction: 'search',
        search_start: '0',
        full_search: '0',
        result_from: '1',
        story: title,
      }).toString(),
    });
    if (!html) return null;

    for (const { slug, names } of this.parseSearchResults(html)) {
      if (names.some((name) => name === title)) return slug;
    }

    return null;
  }

  /**
   * Parse DLE search results into {slug, names}.
   * Titles render as "Original Name / Русское название" — split so either side
   * can match the source platform's title list.
   */
  private parseSearchResults(html: string): Array<{ slug: string; names: string[] }> {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const results: Array<{ slug: string; names: string[] }> = [];
    const seen = new Set<string>();

    for (const link of doc.querySelectorAll('a[href*=".html"]')) {
      const href = link.getAttribute('href');
      if (!href) continue;

      const slug = this.getSlugFromURL(new URL(href, BASE_URL).href);
      if (!slug || seen.has(slug)) continue;

      const text = link.textContent?.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      seen.add(slug);
      results.push({
        slug,
        names: text.split('/').map((part) => part.trim()).filter(Boolean),
      });
    }

    return results;
  }

  /**
   * Fetch a page with credentials and reject anti-bot challenge responses.
   * The challenge needs JS (fingerprint + POST /_v) which we cannot run here,
   * so a challenged response is a hard failure — better a logged null than a
   * silent "0 chapters".
   */
  private async fetchPage(url: string, options?: RequestInit): Promise<string | null> {
    const html = await this.fetch<string>(url, {
      ...options,
      withCredentials: true,
    } as RequestInit);

    if (!html || typeof html !== 'string') return null;

    if (!html.includes('__DATA__') && /["']\/_v["']|targetUrl/.test(html)) {
      Logger.warn(this.config.key, 'Anti-bot challenge served — open com-x.life to refresh access', url);
      return null;
    }

    return html;
  }

  /** Read the reader page's `__DATA__` (next/prev links + post_link). */
  parseReaderHTML(html: string): ComXReaderData | null {
    return this.parseData<ComXReaderData>(html);
  }

  /** Extract and parse the `window.__DATA__` payload from a page. */
  private parseData<T = ComXData>(html: string): T | null {
    const marker = html.indexOf('__DATA__');
    if (marker === -1) {
      Logger.warn(this.config.key, 'No __DATA__ in page');
      return null;
    }

    const objectStart = html.indexOf('{', marker);
    if (objectStart === -1) return null;

    const json = sliceBalancedJson(html, objectStart);
    if (!json) {
      Logger.warn(this.config.key, 'Unbalanced __DATA__ object');
      return null;
    }

    try {
      return JSON.parse(json) as T;
    } catch (error) {
      Logger.error(this.config.key, 'Failed to parse __DATA__', error);
      return null;
    }
  }

  /**
   * Total = highest `posi`; progress = highest `posi` among read chapters.
   * Falls back to `bookmark.chapter_id` (the "continue from" marker), which is
   * a separate thing the site does not update when chapters are marked read.
   */
  private async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const html = await this.fetchPage(`${BASE_URL}/${slug}.html`);
    if (!html) return null;

    const data = this.parseData(html);
    const chapters = data?.chapters;
    if (!chapters?.length) return null;

    const posiOf = (chapter: ComXChapter) => Number(chapter.posi) || 0;
    const chapter = Math.max(...chapters.map(posiOf));

    // Progress lives in two places and neither is trustworthy on its own:
    // marking chapters read is a manual action here (users tick a couple at
    // most), while the bookmark is the "continue from" marker the reader keeps
    // up to date. Whichever sits further along is the real position.
    const readIds = new Set(normalizeReaded(data?.readed));
    const readPosi = chapters.filter((c) => readIds.has(Number(c.id))).map(posiOf);

    const lastChapterRead = Math.max(
      readPosi.length ? Math.max(...readPosi) : 0,
      this.resolveBookmarkPosi(data, chapters)
    );

    return { chapter, lastChapterRead };
  }

  /**
   * Cumulative position of the "continue from" bookmark, or 0 when unset —
   * PHP serialises the empty bookmark as `[]` rather than an object.
   */
  private resolveBookmarkPosi(data: ComXData | null, chapters: ComXChapter[]): number {
    const bookmark = data?.bookmark;
    if (!bookmark || Array.isArray(bookmark)) return 0;

    const bookmarkId = Number(bookmark.chapter_id) || 0;
    const bookmarked = chapters.find((c) => Number(c.id) === bookmarkId);
    return bookmarked ? Number(bookmarked.posi) || 0 : 0;
  }

  /**
   * Get manga metadata (with fetch)
   */
  async getManga(slug: string): Promise<Manga | null> {
    const html = await this.fetchPage(`${BASE_URL}/${slug}.html`);
    if (!html) return null;
    return this.parseMangaHTML(html);
  }

  /**
   * Parse manga metadata from HTML (no fetch).
   * `__DATA__.title` holds the Russian name; h1 carries "Original / Русское".
   */
  parseMangaHTML(html: string): Manga | null {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const heading = doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim();
      const parts = heading?.split('/').map((part) => part.trim()).filter(Boolean) ?? [];

      const name = this.parseData(html)?.title || parts[0];
      if (!name) return null;

      const otherNames = [...new Set(parts.filter((part) => part !== name))];
      return { name, otherNames };
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
   * Get user's bookmark/progress
   */
  async getBookmark(slug: string): Promise<Bookmark | null> {
    const data = await this.getMangaData(slug);
    if (!data) return null;

    return { chapter: data.lastChapterRead, lastChapterRead: data.lastChapterRead };
  }

  /**
   * Simple search by query - for popup use
   */
  async searchByQuery(query: string): Promise<Array<{ title: string; slug: string; image?: string }>> {
    const html = await this.fetchPage(`${BASE_URL}/index.php?do=search`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        do: 'search',
        subaction: 'search',
        search_start: '0',
        full_search: '0',
        result_from: '1',
        story: query,
      }).toString(),
    });
    if (!html) return [];

    return this.parseSearchResults(html)
      .slice(0, 5)
      .map(({ slug, names }) => ({ title: names.join(' / '), slug }));
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
export const comxAPI = new ComXAPI();
