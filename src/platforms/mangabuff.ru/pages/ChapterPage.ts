/**
 * ChapterPage for MangaBuff
 * Auto-advance to next chapter on scroll to bottom
 */
import { BasePage } from '@/src/pages';
import { createScrollAdvance } from '@/src/utils';
import { cache } from '@/src/utils/storage';

export class ChapterPage extends BasePage {
  private advance = createScrollAdvance({
    onReachBottom: () => this.clickNextChapter(),
  });

  protected async initialize(): Promise<void> {
    await this.invalidateCache();
  }

  async render(): Promise<void> {
    this.advance.start();
  }

  private clickNextChapter(): void {
    const footer = document.querySelector('.reader__footer');
    if (!footer) return;

    const links = footer.querySelectorAll<HTMLAnchorElement>('a.button--primary');
    for (const link of links) {
      if (link.textContent?.trim().startsWith('След.')) {
        link.click();
        return;
      }
    }
  }

  private async invalidateCache(): Promise<void> {
    const slug = this.getSlugFromUrl();
    if (!slug) return;
    await cache.delete('mangabuff', slug);
  }

  private getSlugFromUrl(): string {
    const match = window.location.pathname.match(/^\/manga\/([^/]+)/);
    return match?.[1] ?? '';
  }

  async destroy(): Promise<void> {
    this.advance.stop();
  }
}
