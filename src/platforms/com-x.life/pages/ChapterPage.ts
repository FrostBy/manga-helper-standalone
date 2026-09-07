/**
 * ChapterPage for com-x.life
 * Auto-advance to next chapter on scroll to bottom
 *
 * The reader ships its own `__DATA__` with ready-made `next`/`prev` chapter
 * URLs, so navigation goes through those instead of clicking a rendered button.
 */
import { BasePage } from '@/src/pages';
import { createScrollAdvance } from '@/src/utils';
import { cache } from '@/src/utils/storage';
import { comxAPI } from '@/src/api';

const BASE_URL = 'https://com-x.life';

export class ChapterPage extends BasePage {
  private nextChapterUrl: string | null = null;

  private advance = createScrollAdvance({
    onReachBottom: () => {
      if (this.nextChapterUrl) window.location.href = this.nextChapterUrl;
    },
  });

  protected async initialize(): Promise<void> {
    const data = comxAPI.parseReaderHTML(document.documentElement.outerHTML);
    this.nextChapterUrl = data?.next || null;

    // Reading a chapter changes progress — drop the title's cached counters.
    await this.invalidateCache(data?.post_link);
  }

  async render(): Promise<void> {
    // Last chapter — nothing to advance to.
    if (!this.nextChapterUrl) return;

    this.advance.start();
  }

  /** Reader URL has only a numeric news_id — the slug lives in `post_link`. */
  private async invalidateCache(postLink?: string): Promise<void> {
    if (!postLink) return;

    try {
      const slug = comxAPI.getSlugFromURL(new URL(postLink, BASE_URL).href);
      if (slug) await cache.delete('comx', slug);
    } catch {
      // Malformed post_link — nothing to invalidate
    }
  }

  async destroy(): Promise<void> {
    this.advance.stop();
    this.nextChapterUrl = null;
  }
}
