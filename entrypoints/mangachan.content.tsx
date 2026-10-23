/**
 * Manga-chan content script
 */
import { render } from 'preact';
import { MangaChanRouter } from '@/src/platforms/manga-chan.me/router';
import { initLogger, Logger } from '@/src/utils';
import { setSiteLoader } from '@/src/components/SiteLoader';
import { mangachanLoader } from '@/src/components/siteLoaders';
import { OnboardingTooltip } from '@/src/components/OnboardingTooltip';
import '@/src/styles/shared.scss';
import '@/src/platforms/manga-chan.me/styles.scss';

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
  matches: ['*://*.manga-chan.me/*'],
  runAt: 'document_end',

  async main() {
    await initLogger();
    setSiteLoader(mangachanLoader);
    Logger.info('Manga-chan', 'Content script loaded');

    const onboardingContainer = document.createElement('div');
    onboardingContainer.id = 'manga-helper-onboarding';
    document.body.appendChild(onboardingContainer);
    render(<OnboardingTooltip />, onboardingContainer);

    const router = new MangaChanRouter();
    router.setupNavigationListener();
    router.init();
  },
});
