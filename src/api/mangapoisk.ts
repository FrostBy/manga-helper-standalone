/**
 * MangaPoisk API — HTML pages. No per-chapter progress on the site, so progress
 * is what the chapter page saved while reading.
 */

import { BasePlatformAPI, type Candidate, type QueryItem } from './base';
import { userProgress } from '@/src/utils/storage';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch } from '@/src/utils/manga';
import { yearIn, type TitleProfile } from '@/src/utils/matchScore';
import type { PlatformConfig, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const HOST = 'https://mangapoisk.me';
const CHAPTERS_PER_PAGE = 50;

interface TitlePage {
  names: string[];
  chapters: number;
  year?: number;
}

interface SearchHit {
  slug: string;
  title: string;
  image?: string;
}

export class MangaPoiskAPI extends BasePlatformAPI {
  readonly config: PlatformConfig = {
    key: 'mangapoisk',
    domain: 'mangapoisk.me',
    title: 'MangaPoisk',
  };

  link(slug: string): string {
    return `${HOST}/manga/${slug}`;
  }

  getSlugFromURL(url: string): string | null {
    return parseSlugFromUrl(url, ['mangapoisk.me', 'mangapoisk.ru'], /^\/manga\/([^/?#]+)/);
  }

  private parse(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  /**
   * "Глав: N" is a count — the last chapter's number runs ahead of it
   * (450 chapters, the last numbered 463), and totals are positions.
   */
  private fetchTitlePage(slug: string): Promise<TitlePage | null> {
    return this.shared(`page:${slug}`, async () => {
      const html = await this.fetch<string>(`${HOST}/manga/${slug}`);
      if (typeof html !== 'string') return null;
      const doc = this.parse(html);
      const labelled = (text: string) => [...doc.querySelectorAll('b')].find((b) => b.textContent?.trim() === text)?.parentElement;
      const heading = doc.querySelector('h1');
      // A 200 without the title heading is a stub or a block page, not a title.
      if (!heading) {
        this.failedFetches++;
        return null;
      }
      // A title with no chapters yet may have no count row at all.
      const chapters = Number(labelled('Глав:')?.textContent?.replace(/\D+/g, '')) || 0;
      const names = [...heading.querySelectorAll('span')]
        .map((span) => span.textContent?.replace(/^\s*\/\s*/, '').trim() ?? '')
        .filter(Boolean);
      return { names, chapters, year: yearIn(labelled('Год:')?.textContent) };
    });
  }

  async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const page = await this.fetchTitlePage(slug);
    if (!page) return null;
    return { chapter: page.chapters, lastChapterRead: Math.min(await userProgress.get(this.config.key, slug), page.chapters) };
  }

  /**
   * Chapters list newest first, 50 per page. Recent chapters sit on the first
   * pages, so reading new ones costs a request or two.
   */
  async getChapterPosition(slug: string, chapterPath: string): Promise<number> {
    const page = await this.fetchTitlePage(slug);
    if (!page) return 0;
    const pages = Math.ceil(page.chapters / CHAPTERS_PER_PAGE);
    for (let p = 1; p <= pages; p++) {
      const html = await this.fetch<string>(`${HOST}/manga/${slug}?tab=chapters&page=${p}`);
      if (typeof html !== 'string') return 0;
      const paths = [
        ...new Set(
          [...this.parse(html).querySelectorAll('a[href*="/chapter/"]')].map((a) => new URL(a.getAttribute('href')!, HOST).pathname)
        ),
      ];
      const index = paths.indexOf(chapterPath);
      if (index >= 0) return Math.max(0, page.chapters - (p - 1) * CHAPTERS_PER_PAGE - index);
      if (paths.length === 0) return 0;
    }
    return 0;
  }

  async getManga(slug: string): Promise<Manga | null> {
    const page = await this.fetchTitlePage(slug);
    const [name, ...otherNames] = page?.names ?? [];
    return name ? { name, otherNames } : null;
  }

  async getProfile(slug: string): Promise<TitleProfile | null> {
    const page = await this.fetchTitlePage(slug);
    return page && { year: page.year, authors: [], ids: {} };
  }

  protected async candidatesFor(query: string, titles: string[]): Promise<Candidate[] | null> {
    const hits = await this.searchPage(query);
    return hits && hits.filter((hit) => titlesMatch([hit.title], titles)).map(({ slug }) => ({ slug }));
  }

  private async searchPage(query: string): Promise<SearchHit[] | null> {
    const html = await this.fetch<string>(`${HOST}/search?q=${encodeURIComponent(query)}`);
    if (typeof html !== 'string') return null;
    const doc = this.parse(html);
    // A 200 without the search box is a stub or a block page; read as "nothing found" it would cache a miss.
    if (!doc.querySelector('#search-input')) {
      this.failedFetches++;
      return null;
    }
    const seen = new Set<string>();
    return [...doc.querySelectorAll('a[href*="/manga/"][title]')].flatMap((a) => {
      const img = a.querySelector('img');
      const slug = this.getSlugFromURL(new URL(a.getAttribute('href')!, HOST).href);
      const title = a.getAttribute('title')?.trim();
      if (!img || !slug || !title || seen.has(slug)) return [];
      seen.add(slug);
      return [{ slug, title, image: img.getAttribute('src') ?? undefined }];
    });
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
    return this.searchPage(query);
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

export const mangapoiskAPI = new MangaPoiskAPI();
