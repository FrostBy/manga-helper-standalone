/**
 * Inkstory API
 * Uses REST API + Astro component parsing
 */

import { BasePlatformAPI } from './base';
import { Logger } from '@/src/utils/logger';
import { userProgress } from '@/src/utils/storage';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import type { PlatformConfig, PlatformKey, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const BASE_URL = 'https://inkstory.net';
const API_URL = 'https://api.inkstory.net/v2/books';

/**
 * Inkstory Search API Response DTO
 * GET /v2/books?search={query}&ignoreUserScopedContentStatus=true&serviceName=inkstory
 * Returns array directly
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

/**
 * One chapter as it appears in the page state.
 *
 * There is no cumulative ordinal here: `number` restarts inside every volume
 * and can even be fractional (`68.1` for an extra), so reading position has to
 * be derived by counting chapters rather than by reading a field.
 */
interface InkstoryChapterRef {
  id: string;
  branchId: string;
  volume: number;
  number: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Inkstory ships page state as a devalue-encoded array where every value is an
 * index into that same array. These resolve a reference one level down.
 */
function derefValue(state: unknown[], ref: unknown): unknown {
  return typeof ref === 'number' ? state[ref] : ref;
}

function derefNumber(state: unknown[], ref: unknown): number | null {
  const value = derefValue(state, ref);
  return typeof value === 'number' ? value : null;
}

function derefString(state: unknown[], ref: unknown): string | null {
  const value = derefValue(state, ref);
  return typeof value === 'string' ? value : null;
}

/**
 * Every chapter in the state, de-duplicated by id — the same chapter is
 * encoded more than once (chapters list, bookmark, "latest" block).
 */
function collectChapters(state: unknown[]): InkstoryChapterRef[] {
  const chapters = new Map<string, InkstoryChapterRef>();

  for (const item of state) {
    if (!isRecord(item)) continue;
    if (!('number' in item) || !('volume' in item) || !('branchId' in item)) continue;

    const id = derefString(state, item.id);
    const branchId = derefString(state, item.branchId);
    const volume = derefNumber(state, item.volume);
    const number = derefNumber(state, item.number);
    if (id === null || branchId === null || volume === null || number === null) continue;

    chapters.set(id, { id, branchId, volume, number });
  }

  return [...chapters.values()];
}

/** Chapters of a single branch (translator) in reading order. */
function sortBranchChapters(
  chapters: InkstoryChapterRef[],
  branchId: string
): InkstoryChapterRef[] {
  return chapters
    .filter((chapter) => chapter.branchId === branchId)
    .sort((a, b) => a.volume - b.volume || a.number - b.number);
}

/**
 * Derive total chapters + reading position from Inkstory's page state.
 *
 * Exported because the content script reads the very same state off the live
 * page — keeping one implementation avoids the two drifting apart.
 */
export function parseAstroState(state: unknown[]): {
  chapter: number;
  lastChapterRead: number;
} {
  const chapters = collectChapters(state);

  // Total = the fullest branch, counted from the chapters themselves.
  // The `chaptersCount` fields disagree (the book-level one lags behind and
  // skips extras like `68.1`), so they only serve as a fallback for when the
  // state carries no chapter objects at all.
  const countPerBranch = new Map<string, number>();
  for (const { branchId } of chapters) {
    countPerBranch.set(branchId, (countPerBranch.get(branchId) ?? 0) + 1);
  }

  let chapter = Math.max(0, ...countPerBranch.values());

  if (chapter === 0) {
    const declaredCounts: number[] = [];
    for (const item of state) {
      if (!isRecord(item) || !('chaptersCount' in item)) continue;
      const count = derefNumber(state, item.chaptersCount);
      if (count !== null) declaredCounts.push(count);
    }
    chapter = Math.max(0, ...declaredCounts);
  }

  // Progress = the bookmarked chapter's position within its own branch.
  // `chapter.number` cannot be used: it restarts per volume, so a bookmark on
  // "volume 2, chapter 70" of a 141-chapter title used to report 70.
  let lastChapterRead = 0;
  for (const item of state) {
    if (!isRecord(item) || !('chapter' in item) || !('userId' in item)) continue;

    const bookmarked = derefValue(state, item.chapter);
    if (!isRecord(bookmarked)) continue;

    const id = derefString(state, bookmarked.id);
    const branchId = derefString(state, bookmarked.branchId);
    if (id === null || branchId === null) continue;

    const ordinal =
      sortBranchChapters(chapters, branchId).findIndex((c) => c.id === id) + 1;
    if (ordinal > lastChapterRead) lastChapterRead = ordinal;
  }

  return { chapter, lastChapterRead };
}

export class InkstoryAPI extends BasePlatformAPI {
  readonly config: PlatformConfig = {
    key: 'inkstory',
    domain: 'inkstory.net',
    title: 'Inkstory',
  };

  link(slug: string): string {
    return `${BASE_URL}/content/${slug}?tab=chapters`;
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
    const url = `${API_URL}?search=${encodeURIComponent(title)}&ignoreUserScopedContentStatus=true&serviceName=inkstory`;
    const response = await this.fetch<InkstorySearchResult>(url);

    // API returns array directly
    if (!response || !Array.isArray(response) || response.length === 0) {
      return null;
    }

    // Find matching book by altNames or name values
    const matched = response.find((book) => {
      const altMatch = book.altNames?.some((alt) => alt.name === title);
      const nameMatch = book.name && Object.values(book.name).some((name) => name === title);
      return altMatch || nameMatch;
    });

    return matched?.slug ?? null;
  }

  /**
   * Get manga data by parsing it-astro-state script (devalue format)
   * Contains: chaptersCount, current-book-bookmarks with chapter number
   */
  private async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const url = `${BASE_URL}/content/${slug}?tab=chapters`;

    // Use cookies for authenticated data (bookmarks)
    const html = await this.fetch<string>(url, { withCredentials: true } as RequestInit);

    if (!html || typeof html !== 'string') return null;

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Parse it-astro-state script (devalue format)
      const stateScript = doc.querySelector('script#it-astro-state');
      if (!stateScript?.textContent) {
        Logger.warn(this.config.key, 'Could not find it-astro-state script');
        return null;
      }

      const state = JSON.parse(stateScript.textContent);
      if (!Array.isArray(state)) return null;

      const { chapter, lastChapterRead: parsedRead } = parseAstroState(state);
      let lastChapterRead = parsedRead;

      // Fallback: read from userProgress storage (saved when user visits Inkstory)
      if (lastChapterRead === 0) {
        lastChapterRead = await userProgress.get(this.config.key, slug);
      }

      return { chapter, lastChapterRead };
    } catch (error) {
      Logger.error(this.config.key, 'Failed to parse manga page', error);
      return null;
    }
  }

  /**
   * Get manga metadata (with fetch)
   */
  async getManga(slug: string): Promise<Manga | null> {
    const url = `${BASE_URL}/content/${slug}`;
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

      // Parse title from h1
      const h1 = doc.querySelector('h1');
      const name = h1?.textContent?.trim();
      if (!name) return null;

      // Parse alternative names from p after h1
      const otherNames: string[] = [];
      const altP = h1?.nextElementSibling;
      if (altP?.tagName === 'P' && altP.textContent) {
        const alts = altP.textContent.split('/').map((s) => s.trim()).filter(Boolean);
        otherNames.push(...alts);
      }

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
    const url = `${API_URL}?search=${encodeURIComponent(query)}&ignoreUserScopedContentStatus=true&serviceName=inkstory`;
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
