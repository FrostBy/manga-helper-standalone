/**
 * Remanga API — public JSON API; the user's progress needs the site's token
 * (cookie `auth:token`, saved by the router).
 */

import { BasePlatformAPI, type Candidate, type QueryItem } from './base';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch } from '@/src/utils/manga';
import type { TitleProfile } from '@/src/utils/matchScore';
import type { PlatformConfig, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const SITE_URL = 'https://remanga.org';
const API_URL = 'https://api.remanga.org/api';

interface RemangaChapterRef {
  id: number;
}

interface RemangaTitle {
  id: number;
  dir: string;
  main_name?: string;
  secondary_name?: string;
  another_name?: string | null;
  count_chapters?: number;
  branches?: Array<{ id: number; count_chapters?: number }>;
  continue_reading?: RemangaChapterRef | null;
  cover?: { mid?: string } | null;
  issue_year?: number | null;
  creators?: Array<{ name?: string | null; type: number }>;
}

/** `creators` mixes authors with the publisher (Kodansha is type 3). */
const PUBLISHER = 3;

interface RemangaSearchResponse {
  content?: RemangaTitle[];
}

const namesOf = (title: RemangaTitle): string[] =>
  [title.main_name, title.secondary_name, ...(title.another_name?.split(' / ') ?? [])].filter(
    (name): name is string => !!name?.trim()
  );

export class RemangaAPI extends BasePlatformAPI {
  readonly config: PlatformConfig = {
    key: 'remanga',
    domain: 'remanga.org',
    title: 'Remanga',
  };

  link(slug: string): string {
    return `${SITE_URL}/manga/${encodeURIComponent(slug)}/main`;
  }

  /** Some dirs carry a date prefix (`<29.04.2026>naruto_`) that URLs percent-encode. */
  getSlugFromURL(url: string): string | null {
    const slug = parseSlugFromUrl(url, ['remanga.org'], /^\/manga\/([^/?#]+)/);
    if (!slug) return null;
    try {
      return decodeURIComponent(slug);
    } catch {
      return null;
    }
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return token ? { Authorization: `bearer ${token}` } : {};
  }

  /** The page, the rows and the search all ask for the same title at once. */
  private fetchTitle(slug: string): Promise<RemangaTitle | null> {
    return this.shared(`title:${slug}`, async () =>
      this.fetch<RemangaTitle>(`${API_URL}/v2/titles/${encodeURIComponent(slug)}/`, { headers: await this.authHeaders() })
    );
  }

  /** `null` when the request failed: a guessed 0 would be cached as the progress. */
  private async chapterIndex(chapterId: number): Promise<number | null> {
    const chapter = await this.fetch<{ index?: number }>(`${API_URL}/v2/titles/chapters/${chapterId}/`);
    return chapter ? (chapter.index ?? 0) : null;
  }

  /**
   * Mirrors the site's own "Read" button: the chapter in progress, else the one
   * before the chapter it offers to continue with. Chapter numbers aren't
   * positions (a branch of 77 can end with chapter 78), so `index` is used.
   * A rejected token reads as signed out — the row keeps its counts.
   */
  private async readPosition(title: RemangaTitle): Promise<number | null> {
    const headers = await this.authHeaders();
    if (!headers.Authorization) return 0;
    const result = await this.request<{ chapter_id?: number | null; chapter?: RemangaChapterRef | null }>(
      `${API_URL}/v2/titles/${title.id}/my-progress/`,
      { headers }
    );
    if (!result.ok) return result.status === 401 || result.status === 403 ? 0 : null;
    const current = result.data.chapter?.id ?? result.data.chapter_id;
    if (current) return this.chapterIndex(current);
    if (!title.continue_reading?.id) return 0;
    const next = await this.chapterIndex(title.continue_reading.id);
    return next === null ? null : Math.max(0, next - 1);
  }

  async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const title = await this.fetchTitle(slug);
    if (!title?.id) return null;
    // Branches are translations of one title: the largest is the count, not their sum.
    const branches = (title.branches ?? []).map((b) => b.count_chapters ?? 0);
    const chapter = branches.length ? Math.max(...branches) : (title.count_chapters ?? 0);
    const position = await this.readPosition(title);
    if (position === null) return null;
    return { chapter, lastChapterRead: Math.min(position, chapter) };
  }

  protected async candidatesFor(query: string, titles: string[]): Promise<Candidate[] | null> {
    const items = await this.searchTitles(query);
    return items && items.filter((item) => item.dir && titlesMatch(namesOf(item), titles)).map(({ dir }) => ({ slug: dir }));
  }

  async getProfile(slug: string): Promise<TitleProfile | null> {
    const title = await this.fetchTitle(slug);
    if (!title?.id) return null;
    const authors = (title.creators ?? []).flatMap((creator) => (creator.name && creator.type !== PUBLISHER ? [creator.name] : []));
    return { year: title.issue_year ?? undefined, authors, ids: {} };
  }

  private async searchTitles(query: string): Promise<RemangaTitle[] | null> {
    const response = await this.fetch<RemangaSearchResponse>(
      `${API_URL}/search/?query=${encodeURIComponent(query)}&count=20`
    );
    return response ? (response.content ?? []) : null;
  }

  async getManga(slug: string): Promise<Manga | null> {
    const title = await this.fetchTitle(slug);
    const [name, ...otherNames] = title ? namesOf(title) : [];
    return name ? { name, otherNames, cover: title?.cover?.mid && `${SITE_URL}${title.cover.mid}` } : null;
  }

  async getChapters(slug: string): Promise<ChaptersResponse | null> {
    const data = await this.getMangaData(slug);
    return data && { data: Array.from({ length: data.chapter }, (_, i) => ({ number: i + 1 })) };
  }

  async getBookmark(slug: string): Promise<Bookmark | null> {
    const data = await this.getMangaData(slug);
    return data && { chapter: data.lastChapterRead, lastChapterRead: data.lastChapterRead };
  }

  async searchByQuery(query: string): Promise<QueryItem[] | null> {
    const items = await this.searchTitles(query);
    if (!items) return null;
    return items.map((item) => ({
      title: item.main_name || item.secondary_name || item.dir,
      slug: item.dir,
      image: item.cover?.mid ? `${SITE_URL}${item.cover.mid}` : undefined,
    }));
  }

  async getData(slug: string): Promise<SearchResult | null> {
    const cached = await this.getCached(slug);
    if (cached) return this.prepareResponse(slug, cached.chapter, cached.lastChapterRead);

    const data = await this.getMangaData(slug);
    if (!data) return null;

    await this.cacheResult(slug, data.chapter, data.lastChapterRead);
    return this.prepareResponse(slug, data.chapter, data.lastChapterRead);
  }
}

export const remangaAPI = new RemangaAPI();
