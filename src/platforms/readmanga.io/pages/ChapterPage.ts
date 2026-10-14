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
      // After the last chapter the button leads to `/{slug}/finish` (summary),
      // so only a link to another chapter counts as "next".
      const next = document.querySelector<HTMLAnchorElement>('.next-button-web');
      const path = next ? new URL(next.href, location.href).pathname : '';
      if (/^\/[^/]+\/vol\d+\/\d+/.test(path)) next!.click();
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
