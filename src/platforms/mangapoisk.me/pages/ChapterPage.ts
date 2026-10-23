/**
 * ChapterPage for MangaPoisk — the site keeps no per-chapter progress, so the
 * opened chapter's position is saved here, and the cached row dropped so it shows.
 */
import { BasePage } from '@/src/pages';
import { mangapoiskAPI } from '@/src/api';
import { cache, userProgress } from '@/src/utils/storage';

export class ChapterPage extends BasePage {
  protected async initialize(): Promise<void> {
    const slug = mangapoiskAPI.getSlugFromURL(window.location.href);
    if (!slug) return;

    const position = await mangapoiskAPI.getChapterPosition(slug, window.location.pathname);
    if (!position || this.signal.aborted) return;
    await userProgress.set('mangapoisk', slug, position);
    await cache.delete('mangapoisk', slug);
  }

  async render(): Promise<void> {}
  async destroy(): Promise<void> {}
}
