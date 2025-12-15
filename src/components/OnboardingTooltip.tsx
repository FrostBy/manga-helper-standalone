/**
 * Onboarding tooltip that shows on first install
 * Points to extension icon and prompts user to explore features
 */
import { useState, useEffect } from 'preact/hooks';
import { storage } from '@wxt-dev/storage';

const STORAGE_KEY = 'local:onboardingDismissed';

export function OnboardingTooltip() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Check if already dismissed
    storage.getItem<boolean>(STORAGE_KEY).then((dismissed) => {
      if (!dismissed) {
        setShow(true);
      }
    });
  }, []);

  const handleClose = async () => {
    await storage.setItem(STORAGE_KEY, true);
    setShow(false);
  };

  if (!show) return null;

  return (
    <div class="onboarding-tooltip">
      <div class="onboarding-arrow" />
      <div class="onboarding-content">
        <p>{browser.i18n.getMessage('onboardingText')}</p>
        <button class="onboarding-close" onClick={handleClose}>
          {browser.i18n.getMessage('onboardingClose')}
        </button>
      </div>
    </div>
  );
}
