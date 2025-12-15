/**
 * ChapterPage for MangaLib
 * Handles auto-bookmark on scroll and auto-advance to next chapter
 */
import { BasePage } from '@/src/pages';
import { waitForElement } from '@/src/utils/dom';

export class ChapterPage extends BasePage {
  private isScrollbarDragging = false;
  private scrollTimeout: ReturnType<typeof setTimeout> | null = null;

  protected async initialize(): Promise<void> {
    // Wait for bookmark button to appear
    await waitForElement('svg.fa-bookmark');
  }

  async render(): Promise<void> {
    window.addEventListener('scroll', this.handleScroll);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
  }

  /**
   * Debounced scroll handler
   * When user scrolls to bottom:
   * 1. Click bookmark if not already bookmarked
   * 2. Click next chapter link
   */
  private handleScroll = (): void => {
    // Debounce scroll events
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }

    this.scrollTimeout = setTimeout(() => {
      this.onScrollEnd();
    }, 100);
  };

  /**
   * Check if scrolled to bottom and handle auto-actions
   */
  private onScrollEnd(): void {
    const scrolledTo = window.scrollY + window.innerHeight;
    const isReachBottom = document.body.scrollHeight === scrolledTo;

    if (!isReachBottom) return;

    // Don't trigger if user is dragging scrollbar
    if (this.isScrollbarDragging) return;

    // Click bookmark if not already bookmarked
    const bookmarkIcon = document.querySelector('svg.fa-bookmark');
    if (bookmarkIcon) {
      // Check if it's not bookmarked (far = outline, fas = filled)
      const prefix = bookmarkIcon.getAttribute('data-prefix');
      if (prefix === 'far') {
        const button = bookmarkIcon.closest('button, a, [role="button"]');
        if (button) {
          (button as HTMLElement).click();
        }
      }
    }

    // Click next chapter link
    const nextChapterLink = document.querySelector<HTMLAnchorElement>('header a + div + a');
    if (nextChapterLink) {
      nextChapterLink.click();
    }
  }

  /**
   * Detect when user starts dragging scrollbar
   * Check if click is in the scrollbar area (right edge of viewport)
   */
  private handleMouseDown = (event: MouseEvent): void => {
    // Scrollbar is on the right side of viewport
    // Check if click X is beyond the document width (in scrollbar area)
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0 && event.clientX > document.documentElement.clientWidth) {
      this.isScrollbarDragging = true;
    }
  };

  /**
   * Detect when user stops dragging scrollbar
   */
  private handleMouseUp = (): void => {
    this.isScrollbarDragging = false;
  };

  async destroy(): Promise<void> {
    window.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);

    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }
  }
}
