/**
 * com-x.life content script
 * Entry point for com-x.life platform
 */
import { render } from 'preact';
import { ComXRouter } from '@/src/platforms/com-x.life';
import { initLogger, Logger } from '@/src/utils';
import { OnboardingTooltip } from '@/src/components/OnboardingTooltip';
import '@/src/styles/shared.scss';
import '@/src/platforms/com-x.life/styles.scss';

// Import all platform APIs to register them
import '@/src/platforms/mangalib.me/api';
import '@/src/platforms/senkuro.com/api';
import '@/src/platforms/mangabuff.ru/api';
import '@/src/platforms/readmanga.io/api';
import '@/src/platforms/inkstory.net/api';
import '@/src/platforms/com-x.life/api';

export default defineContentScript({
  matches: ['*://*.com-x.life/*'],
  runAt: 'document_end',

  async main() {
    await initLogger();
    Logger.info('ComX', 'Content script loaded');

    // Mount onboarding tooltip
    const onboardingContainer = document.createElement('div');
    onboardingContainer.id = 'manga-helper-onboarding';
    document.body.appendChild(onboardingContainer);
    render(<OnboardingTooltip />, onboardingContainer);

    const router = new ComXRouter();
    router.setupNavigationListener();
    router.init();
  },
});
