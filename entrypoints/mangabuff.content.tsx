/**
 * MangaBuff content script
 * Entry point for mangabuff.ru platform
 */
import { render } from 'preact';
import { MangaBuffRouter } from '@/src/platforms/mangabuff.ru';
import { initLogger, Logger } from '@/src/utils';
import { OnboardingTooltip } from '@/src/components/OnboardingTooltip';
import '@/src/styles/shared.scss';

// Import all platform APIs to register them
import '@/src/platforms/mangalib.me/api';
import '@/src/platforms/senkuro.com/api';
import '@/src/platforms/mangabuff.ru/api';
import '@/src/platforms/readmanga.io/api';
import '@/src/platforms/inkstory.net/api';

export default defineContentScript({
  matches: ['*://*.mangabuff.ru/*'],
  runAt: 'document_end',

  async main() {
    await initLogger();
    Logger.info('MangaBuff', 'Content script loaded');

    // Mount onboarding tooltip
    const onboardingContainer = document.createElement('div');
    onboardingContainer.id = 'manga-helper-onboarding';
    document.body.appendChild(onboardingContainer);
    render(<OnboardingTooltip />, onboardingContainer);

    const router = new MangaBuffRouter();
    router.setupNavigationListener();
    router.init();
  },
});
