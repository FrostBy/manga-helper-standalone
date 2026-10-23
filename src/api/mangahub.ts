/**
 * Mangahub API — HTML pages. No per-chapter progress on the site, so progress
 * is what the chapter page saved while reading.
 */

import { BasePlatformAPI, type Candidate, type QueryItem } from './base';
import { userProgress } from '@/src/utils/storage';
import { parseSlugFromUrl } from '@/src/utils/urlValidation';
import { titlesMatch, chapterPosition } from '@/src/utils/manga';
import { idsInLinks, type TitleProfile } from '@/src/utils/matchScore';
import type { PlatformConfig, SearchResult, Manga, ChaptersResponse, Bookmark } from '@/src/types';

const HOST = 'https://mangahub.ru';

/** `<title>` is "Читать {Russian} ({original}). …" — the only place the original name shows. */
export function namesFromTitlePage(doc: Document): string[] {
  const name = doc.querySelector('h1')?.textContent?.trim();
  const original = doc.title.match(/\(([^()]+)\)\.[^()]*$/)?.[1]?.trim();
  return [name, original].filter((n): n is string => !!n);
}

interface SearchHit {
  slug: string;
  title: string;
  image?: string;
}

export class MangaHubAPI extends BasePlatformAPI {
  readonly config: PlatformConfig = {
    key: 'mangahub',
    domain: 'mangahub.ru',
    title: 'Mangahub',
  };

  link(slug: string): string {
    return `${HOST}/title/${slug}`;
  }

  getSlugFromURL(url: string): string | null {
    return parseSlugFromUrl(url, ['mangahub.ru'], /^\/title\/([^/?#]+)/);
  }

  private parse(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  /**
   * Every chapter on one page (One Piece: 1202), newest first. The "start
   * reading" button (`a.btn`) links the first chapter ahead of the list and
   * would put it on top — chapter 1 would read as the newest.
   */
  private chapterPaths(slug: string): Promise<string[] | null> {
    return this.shared(`chapters:${slug}`, async () => {
      const html = await this.fetch<string>(`${HOST}/title/${slug}/chapters`);
      if (typeof html !== 'string') return null;
      const doc = this.parse(html);
      // A 200 without the title heading is a stub or a block page, not a title.
      if (!doc.querySelector('h1')) {
        this.failedFetches++;
        return null;
      }
      return [...new Set([...doc.querySelectorAll('a[href^="/read/"]:not(.btn)')].map((a) => a.getAttribute('href')!))];
    });
  }

  async getMangaData(slug: string): Promise<{ chapter: number; lastChapterRead: number } | null> {
    const paths = await this.chapterPaths(slug);
    if (!paths) return null;
    return { chapter: paths.length, lastChapterRead: Math.min(await userProgress.get(this.config.key, slug), paths.length) };
  }

  async getChapterPosition(slug: string, chapterPath: string): Promise<number> {
    const paths = await this.chapterPaths(slug);
    return paths ? chapterPosition(paths, chapterPath) : 0;
  }

  /** Names, bridges and profiles all read the title page. */
  private titlePage(slug: string): Promise<{ html: string; doc: Document } | null> {
    return this.shared(`title:${slug}`, async () => {
      const html = await this.fetch<string>(`${HOST}/title/${slug}`);
      return typeof html === 'string' ? { html, doc: this.parse(html) } : null;
    });
  }

  async getManga(slug: string): Promise<Manga | null> {
    const page = await this.titlePage(slug);
    if (!page) return null;
    const [name, ...otherNames] = namesFromTitlePage(page.doc);
    return name ? { name, otherNames } : null;
  }

  async getProfile(slug: string): Promise<TitleProfile | null> {
    const page = await this.titlePage(slug);
    if (!page) return null;
    const authors = [...page.doc.querySelectorAll('.attr-value a[href^="/person/"]')]
      .map((a) => a.textContent?.replace(/,\s*$/, '').trim() ?? '')
      .filter(Boolean);
    return { authors, ids: idsInLinks(page.html) };
  }

  protected async candidatesFor(query: string, titles: string[]): Promise<Candidate[] | null> {
    const hits = await this.searchPage(query);
    return hits && hits.filter((hit) => titlesMatch([hit.title], titles)).map(({ slug }) => ({ slug }));
  }

  private async searchPage(query: string): Promise<SearchHit[] | null> {
    const html = await this.fetch<string>(`${HOST}/search?query=${encodeURIComponent(query)}`);
    if (typeof html !== 'string') return null;
    const doc = this.parse(html);
    // A 200 without the search form is a stub or a block page; read as "nothing found" it would cache a miss.
    if (!doc.querySelector('form[action^="/search"] input[name="query"]')) {
      this.failedFetches++;
      return null;
    }
    const seen = new Set<string>();
    return [...doc.querySelectorAll('a[href^="/title/"]')].flatMap((a) => {
      const img = a.querySelector('img');
      const slug = this.getSlugFromURL(new URL(a.getAttribute('href')!, HOST).href);
      const title = img?.getAttribute('alt')?.trim();
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

export const mangahubAPI = new MangaHubAPI();
