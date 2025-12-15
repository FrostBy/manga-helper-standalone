/**
 * DOM utility functions
 */

/**
 * Wait for element to appear in DOM
 * Uses MutationObserver for efficient detection
 */
export function waitForElement<T extends Element = Element>(
  selector: string,
  timeout = 10000
): Promise<T | null> {
  return new Promise((resolve) => {
    // Check if already exists
    const existing = document.querySelector<T>(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    // Setup timeout
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);

    // Watch for changes
    const observer = new MutationObserver(() => {
      const element = document.querySelector<T>(selector);
      if (element) {
        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

/**
 * Trigger a raw click (mouseup event)
 * Some SPA frameworks intercept click events but not mouseup
 * Use this when regular click() doesn't work
 */
export function triggerRawClick(element: HTMLElement): void {
  const mouseUpEvent = new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    view: window,
  });
  element.dispatchEvent(mouseUpEvent);
}

/**
 * Wait for multiple elements to appear
 */
export function waitForElements<T extends Element = Element>(
  selector: string,
  minCount = 1,
  timeout = 10000
): Promise<NodeListOf<T> | null> {
  return new Promise((resolve) => {
    // Check if already exists
    const existing = document.querySelectorAll<T>(selector);
    if (existing.length >= minCount) {
      resolve(existing);
      return;
    }

    // Setup timeout
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);

    // Watch for changes
    const observer = new MutationObserver(() => {
      const elements = document.querySelectorAll<T>(selector);
      if (elements.length >= minCount) {
        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(elements);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}
