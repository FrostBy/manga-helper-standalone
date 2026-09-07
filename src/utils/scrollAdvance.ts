/**
 * Scroll-to-bottom watcher shared by chapter pages for auto-advance.
 * Platforms supply only what "advance" means; the scroll bookkeeping lives here.
 */

const DEFAULT_DEBOUNCE_MS = 100;
/** Fractional zoom / DPI keeps scroll math a pixel short of an exact match. */
const DEFAULT_SLACK_PX = 2;

export interface ScrollAdvanceOptions {
  onReachBottom: () => void;
  debounceMs?: number;
  slackPx?: number;
}

export interface ScrollAdvance {
  start(): void;
  stop(): void;
}

export function createScrollAdvance({
  onReachBottom,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  slackPx = DEFAULT_SLACK_PX,
}: ScrollAdvanceOptions): ScrollAdvance {
  let isScrollbarDragging = false;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

  const onScrollEnd = (): void => {
    if (isScrollbarDragging) return;

    const scrolledTo = window.scrollY + window.innerHeight;
    if (scrolledTo < document.body.scrollHeight - slackPx) return;

    onReachBottom();
  };

  const handleScroll = (): void => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(onScrollEnd, debounceMs);
  };

  /** Dragging the scrollbar to the very end must not count as reading through. */
  const handleMouseDown = (event: MouseEvent): void => {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0 && event.clientX > document.documentElement.clientWidth) {
      isScrollbarDragging = true;
    }
  };

  const handleMouseUp = (): void => {
    isScrollbarDragging = false;
  };

  return {
    start(): void {
      window.addEventListener('scroll', handleScroll);
      window.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mouseup', handleMouseUp);
    },

    stop(): void {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);

      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
        scrollTimeout = null;
      }
    },
  };
}
