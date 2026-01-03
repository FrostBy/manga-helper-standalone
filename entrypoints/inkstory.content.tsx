/**
 * Inkstory content script
 * Entry point for inkstory.net / manga.ovh platform
 *
 * Runs at document_start to capture it-astro-state script before it's removed
 */
import { render } from 'preact';
import { InkstoryRouter } from '@/src/platforms/inkstory.net';
import { initLogger, Logger } from '@/src/utils';
import { OnboardingTooltip } from '@/src/components/OnboardingTooltip';
import '@/src/styles/shared.scss';
import '@/src/platforms/inkstory.net/styles.scss';

// Import all platform APIs to register them
import '@/src/platforms/mangalib.me/api';
import '@/src/platforms/senkuro.com/api';
import '@/src/platforms/mangabuff.ru/api';
import '@/src/platforms/readmanga.io/api';
import '@/src/platforms/inkstory.net/api';

// Store captured astro state globally for router to access
declare global {
  interface Window {
    __inkstoryAstroState?: unknown[];
  }
}

function captureAstroState(): void {
  // Check if already exists
  const existing = document.querySelector('script#it-astro-state');
  if (existing?.textContent) {
    try {
      window.__inkstoryAstroState = JSON.parse(existing.textContent);
    } catch {
      // Ignore parse errors
    }
    return;
  }

  // Watch for script to appear (it gets removed after page init)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLScriptElement && node.id === 'it-astro-state') {
          try {
            if (node.textContent) {
              window.__inkstoryAstroState = JSON.parse(node.textContent);
            }
          } catch {
            // Ignore parse errors
          }
          observer.disconnect();
          return;
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Stop observing after 10 seconds
  setTimeout(() => observer.disconnect(), 10000);
}

export default defineContentScript({
  matches: ['*://*.inkstory.net/*', '*://*.manga.ovh/*'],
  runAt: 'document_start',

  main() {
    // Capture astro state ASAP before it's removed
    captureAstroState();

    // Wait for DOM to be ready before initializing router
    const initRouter = async () => {
      await initLogger();
      Logger.info('Inkstory', 'Content script loaded');

      // Mount onboarding tooltip
      const onboardingContainer = document.createElement('div');
      onboardingContainer.id = 'manga-helper-onboarding';
      document.body.appendChild(onboardingContainer);
      render(<OnboardingTooltip />, onboardingContainer);

      const router = new InkstoryRouter();
      router.setupNavigationListener();
      router.init();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initRouter, { once: true });
    } else {
      initRouter();
    }
  },
});
