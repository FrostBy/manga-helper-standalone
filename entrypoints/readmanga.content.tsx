/**
 * ReadManga content script
 * Entry point for readmanga.io platform
 */
import { render } from 'preact';
import { ReadMangaRouter } from '@/src/platforms/readmanga.io';
import { initLogger, Logger } from '@/src/utils';
import { setSiteLoader } from '@/src/components/SiteLoader';
import { readmangaLoader } from '@/src/components/siteLoaders';
import { OnboardingTooltip } from '@/src/components/OnboardingTooltip';
import '@/src/styles/shared.scss';
import '@/src/platforms/readmanga.io/styles.scss';

// Import all platform APIs to register them
import '@/src/platforms/mangalib.me/api';
import '@/src/platforms/senkuro.com/api';
import '@/src/platforms/mangabuff.ru/api';
import '@/src/platforms/readmanga.io/api';
import '@/src/platforms/inkstory.net/api';
import '@/src/platforms/com-x.life/api';
import '@/src/platforms/allhentai/api';
import '@/src/platforms/remanga.org/api';
import '@/src/platforms/manga-chan.me/api';
import '@/src/platforms/mangahub.ru/api';
import '@/src/platforms/mangapoisk.me/api';

export default defineContentScript({
  matches: [
    '*://*.zazaza.me/*',
    '*://*.readmanga.io/*',
    '*://*.readmanga.me/*',
    '*://*.mintmanga.one/*',
    '*://*.mintmanga.com/*',
    '*://*.seimanga.me/*',
  ],
  runAt: 'document_end',

  async main() {
    await initLogger();
    setSiteLoader(readmangaLoader);
    Logger.info('ReadManga', 'Content script loaded');

    // Mount onboarding tooltip
    const onboardingContainer = document.createElement('div');
    onboardingContainer.id = 'manga-helper-onboarding';
    document.body.appendChild(onboardingContainer);
    render(<OnboardingTooltip />, onboardingContainer);

    const router = new ReadMangaRouter();
    router.setupNavigationListener();
    router.init();
  },
});
