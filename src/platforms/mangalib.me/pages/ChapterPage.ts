/**
 * ChapterPage for MangaLib
 * Handles auto-bookmark on scroll and auto-advance to next chapter
 */
import { BasePage } from '@/src/pages';
import { waitForElement } from '@/src/utils/dom';
import { createScrollAdvance } from '@/src/utils';

export class ChapterPage extends BasePage {
  private advance = createScrollAdvance({
    onReachBottom: () => {
      this.bookmarkIfNeeded();
      this.clickNextChapter();
    },
  });

  protected async initialize(): Promise<void> {
    // Wait for bookmark button to appear
    await waitForElement('svg.fa-bookmark');
  }

  async render(): Promise<void> {
    this.advance.start();
  }

  /** `far` prefix means outline, i.e. not bookmarked yet. */
  private bookmarkIfNeeded(): void {
    const bookmarkIcon = document.querySelector('svg.fa-bookmark');
    if (bookmarkIcon?.getAttribute('data-prefix') !== 'far') return;

    const button = bookmarkIcon.closest<HTMLElement>('button, a, [role="button"]');
    button?.click();
  }

  private clickNextChapter(): void {
    document.querySelector<HTMLAnchorElement>('header a + div + a')?.click();
  }

  async destroy(): Promise<void> {
    this.advance.stop();
  }
}
