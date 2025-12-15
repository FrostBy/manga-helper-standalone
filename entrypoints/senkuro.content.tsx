/**
 * Senkuro content script
 * Entry point for senkuro.com platform
 */
import { render } from 'preact';
import { SenkuroRouter } from '@/src/platforms/senkuro.com';
import { initLogger, Logger } from '@/src/utils';
import { OnboardingTooltip } from '@/src/components/OnboardingTooltip';
import '@/src/platforms/senkuro.com/styles.scss';
import '@/src/styles/shared.scss';

// Import all platform APIs to register them
import '@/src/platforms/mangalib.me/api';
import '@/src/platforms/senkuro.com/api';
import '@/src/platforms/mangabuff.ru/api';
import '@/src/platforms/readmanga.io/api';
import '@/src/platforms/inkstory.net/api';

export default defineContentScript({
  matches: ['*://*.senkuro.com/*', '*://*.senkuro.me/*'],
  runAt: 'document_end',

  async main() {
    await initLogger();
    Logger.info('Senkuro', 'Content script loaded');

    // Mount onboarding tooltip
    const onboardingContainer = document.createElement('div');
    onboardingContainer.id = 'manga-helper-onboarding';
    document.body.appendChild(onboardingContainer);
    render(<OnboardingTooltip />, onboardingContainer);

    const router = new SenkuroRouter();
    router.setupNavigationListener();
    router.init();
  },
});
