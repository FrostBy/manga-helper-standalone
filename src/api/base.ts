/**
 * Base API class for all platform APIs
 * Provides common functionality: fetch with retry, token management, response formatting
 */

import { bgFetch } from '@/src/utils/fetch';
import { tokens, cache, autoMappings } from '@/src/utils/storage';
import { Logger } from '@/src/utils/logger';
import type { PlatformKey, PlatformConfig, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

// Default retry config
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_BACKOFF = 10000;

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
   * Get auth token for this platform
   */
  protected async getToken(): Promise<string | null> {
    return tokens.get(this.config.key);
  }

  /**
   * Save auth token for this platform
   */
  protected async setToken(token: string): Promise<void> {
    await tokens.set(this.config.key, token);
  }

  /**
   * Fetch with retry and exponential backoff
   */
  protected async fetch<T = unknown>(
    url: string,
    options?: RequestInit,
    timeout: number = DEFAULT_TIMEOUT,
    maxRetries: number = DEFAULT_MAX_RETRIES
  ): Promise<T | null> {
    const context = this.config.key;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        Logger.debug(context, `Fetch attempt ${attempt + 1}/${maxRetries}`, url);

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const result = await bgFetch<T>(url, {
            ...options,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (result !== null) {
            Logger.debug(context, 'Fetch success', url);
            return result;
          }

          // bgFetch returned null - likely an error
          Logger.warn(context, `Fetch returned null`, url);
        } catch (error) {
          clearTimeout(timeoutId);

          if (error instanceof Error && error.name === 'AbortError') {
            Logger.warn(context, `Request timeout (${timeout}ms)`, url);
          } else {
            throw error;
          }
        }

        // Backoff before retry
        if (attempt < maxRetries - 1) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), MAX_BACKOFF);
          Logger.info(context, `Retrying in ${backoff}ms...`);
          await this.sleep(backoff);
        }
      } catch (error) {
        Logger.error(context, `Fetch error`, error);

        if (attempt < maxRetries - 1) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), MAX_BACKOFF);
          await this.sleep(backoff);
        }
      }
    }

    Logger.error(context, `All ${maxRetries} attempts failed`, url);
    return null;
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
   * Save auto-discovered mapping
   */
  protected async saveAutoMapping(
    sourcePlatform: PlatformKey,
    sourceSlug: string,
    targetSlug: string | false
  ): Promise<void> {
    await autoMappings.set(sourcePlatform, sourceSlug, this.config.key, targetSlug);
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
