/**
 * Background service worker
 * Handles cross-origin fetch requests from content scripts
 */
import { autoMappings, cache } from '@/src/utils/storage';

// Flush expired data every hour
const FLUSH_INTERVAL = 60 * 60 * 1000;

export default defineBackground(() => {
  console.log('[Background] Service worker started');

  // Setup declarativeNetRequest rules for Referer headers
  setupRefererRules();

  // Flush expired cache/mappings on startup and periodically
  const flushExpired = async () => {
    try {
      await Promise.all([
        autoMappings.flushExpired(),
        cache.flushExpired(),
      ]);
      console.log('[Background] Flushed expired data');
    } catch (error) {
      console.error('[Background] Failed to flush expired data:', error);
    }
  };

  // Run on startup
  flushExpired();

  // Run periodically
  setInterval(flushExpired, FLUSH_INTERVAL);

  // Listen for messages from content scripts
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'fetch') {
      if (typeof message.url !== 'string') {
        sendResponse({ error: 'Invalid URL' });
        return true;
      }
      handleFetch(message.url, message.options)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ error: error.message }));
      return true; // Will respond asynchronously
    }

    if (message.type === 'clearStorage') {
      Promise.all([
        browser.storage.local.clear(),
        browser.storage.sync.clear(),
      ])
        .then(() => {
          console.log('[Background] Storage cleared');
          sendResponse({ success: true });
        })
        .catch((error) => sendResponse({ error: error.message }));
      return true;
    }

    // Fetch image with custom Referer and return as base64
    if (message.type === 'fetchImage') {
      if (typeof message.url !== 'string') {
        sendResponse({ error: 'Invalid URL' });
        return true;
      }
      handleFetchImage(message.url, message.referer)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ error: error.message }));
      return true;
    }

    return false;
  });
});

/**
 * Handle fetch request from content script
 */
async function handleFetch(
  url: string,
  options?: RequestInit & { withCredentials?: boolean }
): Promise<{ data?: unknown; error?: string }> {
  try {
    const { withCredentials, ...fetchOptions } = options || {};
    const response = await fetch(url, {
      ...fetchOptions,
      credentials: withCredentials ? 'include' : 'omit',
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get('content-type') || '';

    // Parse response based on content type
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return { data };
    } else {
      // Try to parse as JSON anyway (some APIs don't set correct content-type)
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        return { data };
      } catch {
        return { data: text };
      }
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Fetch image with custom Referer header and return as base64 data URL
 */
async function handleFetchImage(
  url: string,
  referer?: string
): Promise<{ data?: string; error?: string }> {
  try {
    const headers: Record<string, string> = {};
    if (referer) {
      headers['Referer'] = referer;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    const blob = await response.blob();
    const base64 = await blobToBase64(blob);
    return { data: base64 };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Convert Blob to base64 data URL
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Setup declarativeNetRequest rules to add Referer headers for protected image domains
 */
async function setupRefererRules() {
  try {
    // Remove old rules first
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existingRules.map((r: { id: any; }) => r.id);

    if (existingIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingIds,
      });
    }

    // Add rule for cover.imglib.info - add Referer header
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: 'Referer',
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: 'https://mangalib.me/',
              },
            ],
          },
          condition: {
            urlFilter: '||cover.imglib.info/*',
            resourceTypes: [chrome.declarativeNetRequest.ResourceType.IMAGE],
          },
        },
      ],
    });

    console.log('[Background] Referer rules configured');
  } catch (error) {
    console.error('[Background] Failed to setup referer rules:', error);
  }
}
