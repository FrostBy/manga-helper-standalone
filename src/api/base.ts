/**
 * Base API class for all platform APIs
 * Provides common functionality: fetch with retry, token management, response formatting
 */

import { bgFetch, type FetchResult } from '@/src/utils/fetch';
import { tokens, cache } from '@/src/utils/storage';
import { Logger } from '@/src/utils/logger';
import type { PlatformKey, PlatformConfig, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const MAX_ATTEMPTS = 3;
/** Just above the background's own 10s abort, so its error arrives first. */
const REQUEST_TIMEOUT_MS = 12000;

/**
 * Abstract base class for platform APIs
 */
export abstract class BasePlatformAPI {
  abstract readonly config: PlatformConfig;

  /**
   * Generate URL to manga page on this platform
   */
  abstract link(slug: string): string;

  /**
   * Extract slug from URL
   */
  abstract getSlugFromURL(url: string): string | null;

  /**
   * Search for manga on this platform by titles
   * Returns SearchResult or null if not found
   */
  abstract search(
    sourcePlatform: PlatformKey,
    sourceSlug: string,
    titles: string[],
    signal?: AbortSignal
  ): Promise<SearchResult | null>;

  /**
   * Get manga metadata (titles, cover, etc.)
   */
  abstract getManga(slug: string): Promise<Manga | null>;

  /**
   * Get chapters list
   */
  abstract getChapters(slug: string): Promise<ChaptersResponse | null>;

  /**
   * Get user's bookmark/progress
   */
  abstract getBookmark(slug: string): Promise<Bookmark | null>;

  /**
   * Simple search by query - for popup use
   * Returns array of {title, slug, image?} results
   */
  abstract searchByQuery(query: string): Promise<Array<{ title: string; slug: string; image?: string }>>;

  /**
   * F4.1: Optional convenience method — fetch + cache chapters/bookmark in one call.
   * Implemented by most platforms but not required by the contract.
   */
  getData?(slug: string): Promise<unknown>;

  /** Token storage key (defaults to config.key, mirrors can override) */
  protected tokenKey = '';

  protected failedFetches = 0;

  /**
   * `search()` returns null both for "no such title" and "a request failed".
   * Caching the latter as not-found hid real titles for an hour, so failures
   * are reported as `undefined` and must not be cached.
   */
  async searchVerified(
    sourcePlatform: PlatformKey,
    sourceSlug: string,
    titles: string[],
    signal?: AbortSignal
  ): Promise<SearchResult | null | undefined> {
    const failedBefore = this.failedFetches;
    const result = await this.search(sourcePlatform, sourceSlug, titles, signal);
    if (result) return result;
    return this.failedFetches > failedBefore ? undefined : null;
  }

  /**
   * Get auth token for this platform
   */
  protected async getToken(): Promise<string | null> {
    return tokens.get(this.tokenKey || this.config.key);
  }

  /**
   * Save auth token for this platform
   */
  protected async setToken(token: string): Promise<void> {
    await tokens.set(this.config.key, token);
  }

  protected async fetch<T = unknown>(url: string, options?: RequestInit): Promise<T | null> {
    const result = await this.request<T>(url, options);
    return result.ok ? result.data : null;
  }

  /**
   * Fetch with retries — only where a retry can help: no answer at all, 408,
   * 429 or 5xx. A 403/404 answers the same on every attempt, and retrying them cost
   * seconds per request (Senkuro behind a VPN, the com-x challenge).
   */
  protected async request<T = unknown>(url: string, options?: RequestInit): Promise<FetchResult<T>> {
    const context = this.config.key;
    let result: FetchResult<T> = { ok: false };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const backoff = 1000 * 2 ** (attempt - 1);
        Logger.info(context, `Retrying in ${backoff}ms...`);
        await this.sleep(backoff);
      }

      // An AbortSignal can't cross the message boundary to the background
      // worker, so the timeout has to be enforced here — otherwise a hung
      // request stalls the whole platform load forever.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<'timeout'>((resolve) => {
        timeoutId = setTimeout(() => resolve('timeout'), REQUEST_TIMEOUT_MS);
      });
      const outcome = await Promise.race([bgFetch<T>(url, options), timedOut]);
      clearTimeout(timeoutId);

      if (outcome === 'timeout') {
        Logger.warn(context, `Request timeout (${REQUEST_TIMEOUT_MS}ms)`, url);
        result = { ok: false };
        continue;
      }

      result = outcome;
      if (result.ok) return result;

      const { status } = result;
      if (status !== undefined && status !== 408 && status !== 429 && status < 500) break;
    }

    Logger.error(context, 'Request failed', url);
    this.failedFetches++;
    return result;
  }

  /**
   * Prepare standard search response
   */
  protected prepareResponse(
    slug: string,
    chapter: number,
    lastChapterRead: number
  ): SearchResult {
    return {
      platform: this.config.title,
      platformKey: this.config.key,
      url: this.link(slug),
      slug,
      chapter,
      lastChapterRead,
    };
  }

  /**
   * Cache search result
   */
  protected async cacheResult(
    slug: string,
    chapter: number,
    lastChapterRead: number
  ): Promise<void> {
    await cache.set(this.config.key, slug, { chapter, lastChapterRead });
  }

  /**
   * Get cached result
   */
  protected async getCached(slug: string) {
    return cache.get(this.config.key, slug);
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
