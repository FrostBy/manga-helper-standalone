/**
 * ChapterPage for Manga-chan — the site keeps no per-chapter progress, so the
 * opened chapter's position is saved here, and the cached row dropped so it shows.
 */
import { BasePage } from '@/src/pages';
import { mangachanAPI } from '@/src/api';
import { cache, userProgress } from '@/src/utils/storage';
import { waitForElement } from '@/src/utils';

export class ChapterPage extends BasePage {
  protected async initialize(): Promise<void> {
    const titleLink = await waitForElement<HTMLAnchorElement>('a.manga-title');
    const slug = titleLink && mangachanAPI.getSlugFromURL(titleLink.href);
    if (!slug) return;

    const position = await mangachanAPI.getChapterPosition(slug, window.location.pathname);
    if (!position || this.signal.aborted) return;
    await userProgress.set('mangachan', slug, position);
    await cache.delete('mangachan', slug);
  }

  async render(): Promise<void> {}
  async destroy(): Promise<void> {}
}
