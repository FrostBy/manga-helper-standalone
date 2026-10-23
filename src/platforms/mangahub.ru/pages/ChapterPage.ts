/**
 * ChapterPage for Mangahub — the site keeps no per-chapter progress, so the
 * opened chapter's position is saved here, and the cached row dropped so it shows.
 */
import { BasePage } from '@/src/pages';
import { mangahubAPI } from '@/src/api';
import { cache, userProgress } from '@/src/utils/storage';
import { waitForElement } from '@/src/utils';

export class ChapterPage extends BasePage {
  protected async initialize(): Promise<void> {
    await waitForElement('a[href^="/title/"]');
    // Other titles are linked too (recommendations); the reader's own is the bare /title/{slug}.
    const slug = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/title/"]')]
      .map((a) => (/^\/title\/[^/]+\/?$/.test(a.getAttribute('href') ?? '') ? mangahubAPI.getSlugFromURL(a.href) : null))
      .find(Boolean);
    if (!slug) return;

    const position = await mangahubAPI.getChapterPosition(slug, window.location.pathname);
    if (!position || this.signal.aborted) return;
    await userProgress.set('mangahub', slug, position);
    await cache.delete('mangahub', slug);
  }

  async render(): Promise<void> {}
  async destroy(): Promise<void> {}
}
