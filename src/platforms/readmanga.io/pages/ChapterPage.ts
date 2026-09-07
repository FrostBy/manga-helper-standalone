/**
 * ChapterPage for ReadManga
 * Auto-advance to next chapter on scroll to bottom
 */
import { BasePage } from '@/src/pages';
import { createScrollAdvance } from '@/src/utils';
import { cache } from '@/src/utils/storage';

export class ChapterPage extends BasePage {
  private advance = createScrollAdvance({
    onReachBottom: () => {
      // `href` points back at the current page — navigation is wired to the
      // site's own click handler, so the element must be clicked.
      document.querySelector<HTMLElement>('.next-button-web')?.click();
    },
  });

  protected async initialize(): Promise<void> {
    await this.invalidateCache();
  }

  async render(): Promise<void> {
    this.advance.start();
  }

  private async invalidateCache(): Promise<void> {
    const slug = this.getSlugFromUrl();
    if (!slug) return;
    await cache.delete('readmanga', slug);
  }

  private getSlugFromUrl(): string {
    const match = window.location.pathname.match(/^\/([^/]+)\/vol/);
    return match?.[1] ?? '';
  }

  async destroy(): Promise<void> {
    this.advance.stop();
  }
}
