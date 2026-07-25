/**
 * ChapterPage for com-x.life
 * Auto-advance to next chapter on scroll to bottom
 *
 * The reader ships its own `__DATA__` with ready-made `next`/`prev` chapter
 * URLs, so navigation goes through those instead of clicking a rendered button.
 */
import { BasePage } from '@/src/pages';
import { cache } from '@/src/utils/storage';
import { comxAPI } from '@/src/api';

const BASE_URL = 'https://com-x.life';
const SCROLL_DEBOUNCE_MS = 100;
/** Fractional zoom/DPI makes scroll math land a pixel short of the exact bottom. */
const BOTTOM_SLACK_PX = 2;

export class ChapterPage extends BasePage {
  private nextChapterUrl: string | null = null;
  private isScrollbarDragging = false;
  private scrollTimeout: ReturnType<typeof setTimeout> | null = null;

  protected async initialize(): Promise<void> {
    const data = comxAPI.parseReaderHTML(document.documentElement.outerHTML);
    this.nextChapterUrl = data?.next || null;

    // Reading a chapter changes progress — drop the title's cached counters.
    await this.invalidateCache(data?.post_link);
  }

  async render(): Promise<void> {
    // Last chapter — nothing to advance to.
    if (!this.nextChapterUrl) return;

    window.addEventListener('scroll', this.handleScroll);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
  }

  private handleScroll = (): void => {
    if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
    this.scrollTimeout = setTimeout(() => this.onScrollEnd(), SCROLL_DEBOUNCE_MS);
  };

  private onScrollEnd(): void {
    if (!this.nextChapterUrl) return;
    if (this.isScrollbarDragging) return;

    const scrolledTo = window.scrollY + window.innerHeight;
    const isReachBottom = scrolledTo >= document.body.scrollHeight - BOTTOM_SLACK_PX;
    if (!isReachBottom) return;

    window.location.href = this.nextChapterUrl;
  }

  private handleMouseDown = (event: MouseEvent): void => {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0 && event.clientX > document.documentElement.clientWidth) {
      this.isScrollbarDragging = true;
    }
  };

  private handleMouseUp = (): void => {
    this.isScrollbarDragging = false;
  };

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
    window.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);

    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }

    this.nextChapterUrl = null;
  }
}
