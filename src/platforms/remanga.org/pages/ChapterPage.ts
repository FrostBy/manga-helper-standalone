/**
 * ChapterPage for Remanga — reading moves the site's progress, so the cached
 * count/progress of this title must not outlive the visit.
 */
import { BasePage } from '@/src/pages';
import { cache } from '@/src/utils/storage';
import { remangaAPI } from '@/src/api';

export class ChapterPage extends BasePage {
  protected async initialize(): Promise<void> {
    const slug = remangaAPI.getSlugFromURL(window.location.href);
    if (slug) await cache.delete('remanga', slug);
  }

  async render(): Promise<void> {}

  async destroy(): Promise<void> {}
}
