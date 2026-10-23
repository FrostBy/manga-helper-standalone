/**
 * Manga-chan API — DLE pages, no JSON. The site keeps no per-chapter progress,
 * so progress is what the chapter page saved while reading.
 */

import { BasePlatformAPI, type Candidate, type QueryItem } from './base';
import { splitTitle } from './mangachanParse';
import { userProgress } from '@/src/utils/storage';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch, chapterPosition } from '@/src/utils/manga';
import type { TitleProfile } from '@/src/utils/matchScore';
import type { PlatformConfig, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

/** manga-chan.me itself is only an entry redirect, often down; the site lives here. */
const HOST = 'https://im.manga-chan.me';
/** Licensed titles are shown only to signed-in users; a guest gets a page without the title or chapters. */
const WITH_SESSION = { withCredentials: true } as RequestInit;

interface TitlePage {
  names: string[];
  authors: string[];
  /** Newest first, as the page lists them. */
  chapterPaths: string[];
}

interface SearchHit {
  slug: string;
  title: string;
  names: string[];
  image?: string;
}

export class MangaChanAPI extends BasePlatformAPI {
  readonly config: PlatformConfig = {
    key: 'mangachan',
    domain: 'im.manga-chan.me',
    title: 'Manga-chan',
  };

  link(slug: string): string {
    return `${HOST}/manga/${slug}.html`;
  }

  getSlugFromURL(url: string): string | null {
    return parseSlugFromUrl(url, ['manga-chan.me'], /^\/manga\/(\d+-[^/]+?)\.html/);
  }

  /** The page, the rows and the reader ask for the same title at once. */
  private fetchTitlePage(slug: string): Promise<TitlePage | null> {
    return this.shared(`page:${slug}`, async () => {
      const html = await this.fetch<string>(`${HOST}/manga/${slug}.html`, WITH_SESSION);
      if (typeof html !== 'string') return null;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const heading = doc.querySelector('h1 a.title_top_a')?.textContent;
      // A 200 without the title heading is a stub or a block page, not a title.
      if (!heading) {
        this.failedFetches++;
        return null;
      }
      const rows = [...doc.querySelectorAll<HTMLTableRowElement>('table.mangatitle tr')];
      const row = (label: string) => rows.find((tr) => tr.cells[0]?.textContent?.trim() === label)?.cells[1];
      const otherNames = row('Другие названия')
        ?.textContent?.split(';')
        .map((name) => name.trim())
        .filter(Boolean);
      const authors = [...(row('Автор')?.querySelectorAll('a[href^="/mangaka/"]') ?? [])]
        .map((a) => a.textContent?.trim() ?? '')
        .filter(Boolean);
      const chapterPaths = [
        ...new Set(
          [...doc.querySelectorAll('.table_cha a[href*="/online/"]')].map(
            (a) => new URL(a.getAttribute('href') ?? '', HOST).pathname
          )
        ),
      ];
      return { names: [...splitTitle(heading), ...(otherNames ?? [])], authors, chapterPaths };
    });
  }

  async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const page = await this.fetchTitlePage(slug);
    if (!page) return null;
    const chapter = page.chapterPaths.length;
    return { chapter, lastChapterRead: Math.min(await userProgress.get(this.config.key, slug), chapter) };
  }

  async getChapterPosition(slug: string, chapterPath: string): Promise<number> {
    const page = await this.fetchTitlePage(slug);
    return page ? chapterPosition(page.chapterPaths, chapterPath) : 0;
  }

  protected async candidatesFor(query: string, titles: string[]): Promise<Candidate[] | null> {
    const hits = await this.searchPage(query);
    return hits && hits.filter((hit) => titlesMatch(hit.names, titles)).map(({ slug }) => ({ slug }));
  }

  async getProfile(slug: string): Promise<TitleProfile | null> {
    const page = await this.fetchTitlePage(slug);
    return page && { authors: page.authors, ids: {} };
  }

  private async searchPage(query: string): Promise<SearchHit[] | null> {
    const html = await this.fetch<string>(`${HOST}/?do=search&subaction=search&story=${encodeURIComponent(query)}`, WITH_SESSION);
    if (typeof html !== 'string') return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // A 200 without the search box is a stub or a block page; read as "nothing found" it would cache a miss.
    if (!doc.querySelector('#searchinput')) {
      this.failedFetches++;
      return null;
    }
    return [...doc.querySelectorAll('.content_row')].flatMap((row) => {
      const href = row.querySelector('h2 a')?.getAttribute('href');
      const slug = href ? this.getSlugFromURL(new URL(href, HOST).href) : null;
      const title = row.getAttribute('title')?.trim() || row.querySelector('h2 a')?.textContent?.trim() || '';
      if (!slug || !title) return [];
      const image = row.querySelector('.manga_images img')?.getAttribute('src') ?? undefined;
      return [{ slug, title, names: splitTitle(title), image }];
    });
  }

  async getManga(slug: string): Promise<Manga | null> {
    const page = await this.fetchTitlePage(slug);
    const [name, ...otherNames] = page?.names ?? [];
    return name ? { name, otherNames } : null;
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
    const hits = await this.searchPage(query);
    return hits && hits.map(({ slug, title, image }) => ({ title, slug, image }));
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

export const mangachanAPI = new MangaChanAPI();
