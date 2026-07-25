/**
 * i18n utility for browser extension translations
 */

type MessageKey =
  | 'otherSites'
  | 'editLink'
  | 'fullLinkToTitle'
  | 'save'
  | 'delete'
  | 'cancel'
  | 'refresh'
  | 'editLinkTooltip'
  | 'searchPlaceholder'
  | 'searching'
  | 'noResults'
  | 'disablePlatform'
  | 'offsetLabel';

/**
 * Get localized message by key
 */
export function t(key: MessageKey): string {
  return browser.i18n.getMessage(key) || key;
}
