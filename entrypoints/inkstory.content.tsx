/**
 * Inkstory content script
 * Entry point for inkstory.net / manga.ovh platform
 */
import { render } from 'preact';
import { InkstoryRouter } from '@/src/platforms/inkstory.net';
import { initLogger, Logger } from '@/src/utils';
import { setSiteLoader } from '@/src/components/SiteLoader';
import { inkstoryLoader } from '@/src/components/siteLoaders';
import { OnboardingTooltip } from '@/src/components/OnboardingTooltip';
import '@/src/styles/shared.scss';
import '@/src/platforms/inkstory.net/styles.scss';

// Import all platform APIs to register them
import '@/src/platforms/mangalib.me/api';
import '@/src/platforms/senkuro.com/api';
import '@/src/platforms/mangabuff.ru/api';
import '@/src/platforms/readmanga.io/api';
import '@/src/platforms/inkstory.net/api';
import '@/src/platforms/com-x.life/api';

export default defineContentScript({
  matches: ['*://*.inkstory.net/*', '*://*.manga.ovh/*'],
  runAt: 'document_start',

  main() {
    // Wait for DOM to be ready before initializing router
    const initRouter = async () => {
      await initLogger();
      setSiteLoader(inkstoryLoader);
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
