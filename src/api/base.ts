/**
 * Base API class for all platform APIs
 * Provides common functionality: fetch with retry, token management, response formatting
 */

import { bgFetch, type FetchResult } from '@/src/utils/fetch';
import { tokens, cache } from '@/src/utils/storage';
import { Logger } from '@/src/utils/logger';
import { isUnavailable, type HostPool } from '@/src/utils/hostPool';
import {
  MAIN_CHAIN,
  currentHost,
  forgetHosts,
  hasFreshChoice,
  hostsFor,
  rememberHost,
  setTitleChain,
} from '@/src/utils/mirrors';
import type { PlatformKey, PlatformConfig, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

export interface QueryResult {
  title: string;
  slug: string;
  image?: string;
  /** Site of the platform (MangaLib / HentaiLib) — the popup groups by it. */
  group?: string;
  chain?: string;
}

/** One site of the platform failed while another answered — the popup marks just that group. */
export interface QueryFailure {
  failedGroup: string;
}

export type QueryItem = QueryResult | QueryFailure;

const MAX_ATTEMPTS = 3;
/** Just above the background's own 10s abort, so its error arrives first. */
const REQUEST_TIMEOUT_MS = 12000;

/**
 * Abstract base class for platform APIs
 */
export abstract class BasePlatformAPI {
  abstract readonly config: PlatformConfig;

  /** `chain` picks the site of the platform; without it the title's remembered one. */
  abstract link(slug: string, chain?: string): string;

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

  /** Popup search; null when no host answered, so the popup can say so instead of "not found". */
  abstract searchByQuery(query: string): Promise<QueryItem[] | null>;

  /**
   * F4.1: Optional convenience method — fetch + cache chapters/bookmark in one call.
   * Implemented by most platforms but not required by the contract.
   */
  getData?(slug: string): Promise<unknown>;

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
    return tokens.get(this.config.key);
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
    let result: FetchResult<T> = { ok: false };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const backoff = 1000 * 2 ** (attempt - 1);
        Logger.info(this.config.key, `Retrying in ${backoff}ms...`);
        await this.sleep(backoff);
      }

      result = await this.attempt<T>(url, options);
      if (result.ok) return result;

      const { status } = result;
      if (status !== undefined && status !== 408 && status !== 429 && status < 500) break;
    }

    Logger.error(this.config.key, 'Request failed', url);
    this.failedFetches++;
    return result;
  }

  private async attempt<T>(url: string, options?: RequestInit): Promise<FetchResult<T>> {
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
      Logger.warn(this.config.key, `Request timeout (${REQUEST_TIMEOUT_MS}ms)`, url);
      return { ok: false };
    }
    return outcome;
  }

  protected apiPool: HostPool | null = null;
  /** Site hosts per chain: links of a hentai title go to the hentai site. */
  protected sitePools: Record<string, HostPool> = {};
  private probes = new Map<string, Promise<void>>();
  private inflight = new Map<string, Promise<unknown>>();

  async forgetHosts(): Promise<void> {
    const pools = [...(this.apiPool ? [this.apiPool] : []), ...Object.values(this.sitePools)];
    if (pools.length > 0) await forgetHosts(pools);
  }

  siteUrl(): string {
    const main = this.sitePools[MAIN_CHAIN];
    return main ? currentHost(main) : `https://${this.config.domain}`;
  }

  /**
   * A page of the site itself proves its host works and, for a title, which
   * chain it lives on — no probe and no catalog lookup needed.
   */
  async claimPage(url: string): Promise<void> {
    const { origin } = new URL(url);
    const found = Object.entries(this.sitePools).find(([, pool]) => pool.hosts.includes(origin));
    if (!found) return;
    const [chain, pool] = found;
    await rememberHost(pool, origin);
    const slug = this.getSlugFromURL(url);
    if (slug) await setTitleChain(this.config.key, slug, chain);
  }

  /**
   * Every host once, moving on when one is unreachable or blocked — retrying a
   * geo-blocked host only wastes the time another one needs. A pass that met
   * 429/5xx is repeated after a pause instead: Lib's hosts share one rate limit,
   * so the next host can't help with those.
   *
   * `notFoundIsAnswer` — for a lookup by slug a 404 is the host saying "no such
   * title"; for GraphQL or search it means a broken host, and the pool moves on.
   */
  protected async requestPool<T = unknown>(
    pool: HostPool,
    path: string,
    options?: RequestInit,
    { notFoundIsAnswer = false } = {}
  ): Promise<FetchResult<T>> {
    let result: FetchResult<T> = { ok: false };
    for (let pass = 0; pass < MAX_ATTEMPTS; pass++) {
      if (pass > 0) await this.sleep(1000 * 2 ** (pass - 1));
      let worthAnotherPass = false;

      for (const host of await hostsFor(pool)) {
        result = await this.attempt<T>(host + path, options);
        // A parked domain or a challenge page answers 200 with HTML.
        if (result.ok && typeof result.data === 'string') result = { ok: false };

        const { status } = result.ok ? { status: 200 } : result;
        const answered =
          result.ok || (status === 404 ? notFoundIsAnswer : status !== undefined && !isUnavailable(status));
        if (answered) {
          await rememberHost(pool, host);
          if (!result.ok && status !== 404) this.failedFetches++;
          return result;
        }
        if (status === 429 || (status ?? 0) >= 500) worthAnotherPass = true;
        Logger.warn(this.config.key, `${host} unavailable (${status ?? 'no answer'})`);
      }
      if (!worthAnotherPass) break;
    }
    Logger.error(this.config.key, 'No host of the pool answered', pool.id);
    this.failedFetches++;
    return result;
  }

  protected async fetchPool<T = unknown>(
    pool: HostPool,
    path: string,
    options?: RequestInit,
    flags?: { notFoundIsAnswer?: boolean }
  ): Promise<T | null> {
    const result = await this.requestPool<T>(pool, path, options, flags);
    return result.ok ? result.data : null;
  }

  /**
   * Off the data path — rows never wait for it, they re-render when it lands.
   * A GET with the user's cookies: DDoS-Guard answers HEAD with 403 even to
   * the user's own browser, and a check the browser already passed isn't a
   * block. Nothing answering still settles on the primary for the TTL, or
   * every call would probe again.
   */
  protected probeSiteHost(pool: HostPool): void {
    if (hasFreshChoice(pool) || this.probes.has(pool.id)) return;
    const probe = (async () => {
      for (const host of await hostsFor(pool)) {
        const result = await this.attempt(`${host}/`, { withCredentials: true } as RequestInit);
        if (result.ok || !isUnavailable(result.status)) return rememberHost(pool, host);
      }
      return rememberHost(pool, pool.hosts[0]);
    })()
      .catch((error) => Logger.warn(this.config.key, 'Site probe failed', error))
      .finally(() => this.probes.delete(pool.id));
    this.probes.set(pool.id, probe);
  }

  /** A page asks for titles, chapters and bookmark at once — one lookup serves them all. */
  protected shared<T>(key: string, load: () => Promise<T>): Promise<T> {
    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const promise = load().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
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
