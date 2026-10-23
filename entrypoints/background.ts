/**
 * Background service worker
 * Handles cross-origin fetch requests from content scripts
 */
import { autoMappings, cache } from '@/src/utils/storage';
import { migrateLegacyToNodes } from '@/src/utils/migration';
import { registerCleanupAlarm, runCleanup } from '@/src/utils/storageCleanup';
import { hostStorageLocks } from '@/src/utils/lock';

const FLUSH_ALARM = 'flushExpired';
const FETCH_TIMEOUT_MS = 10000;
const MAX_ERROR_BODY = 20000;

export default defineBackground(() => {
  hostStorageLocks();
  console.log('[Background] Service worker started');

  // Setup declarativeNetRequest rules for Referer headers
  setupRefererRules();

  // Legacy → node graph migration (runs once per device)
  migrateLegacyToNodes().catch((err) =>
    console.error('[Background] migration failed:', err)
  );

  // Register daily LRU cleanup alarm
  registerCleanupAlarm();
  // Opportunistic cleanup at startup if over 80% quota
  runCleanup().catch((err) =>
    console.error('[Background] startup cleanup failed:', err)
  );

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

  // R2.3: periodic flush via alarms — setInterval dies with MV3 service worker.
  browser.alarms.create(FLUSH_ALARM, { periodInMinutes: 60 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FLUSH_ALARM) flushExpired();
  });

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

    if (message.type === 'refreshSiteAccess') {
      if (typeof message.url !== 'string') {
        sendResponse({ ok: false });
        return true;
      }
      refreshSiteAccess(message.url)
        .then((ok) => sendResponse({ ok }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    return false;
  });
});

/**
 * Anti-bot cookies (com-x) are IP-bound and only a real page visit renews them.
 * Lives here, not in pages: one visit per host at a time that every waiting tab
 * shares — ten open titles must not spawn ten tabs — and none within the
 * cooldown, so a site that keeps challenging can't loop.
 */
const ACCESS_REFRESH_HOSTS = ['com-x.life'];
const ACCESS_COOLDOWN_MS = 10 * 60 * 1000;
const ACCESS_VISIT_TIMEOUT_MS = 15000;
const accessVisits = new Map<string, Promise<boolean>>();
const lastAccessVisit = new Map<string, number>();

function refreshSiteAccess(url: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return Promise.resolve(false);
  }
  if (!ACCESS_REFRESH_HOSTS.includes(host)) return Promise.resolve(false);

  const pending = accessVisits.get(host);
  if (pending) return pending;
  if (Date.now() - (lastAccessVisit.get(host) ?? 0) < ACCESS_COOLDOWN_MS) return Promise.resolve(false);

  lastAccessVisit.set(host, Date.now());
  const visit = visitInBackgroundTab(url).finally(() => accessVisits.delete(host));
  accessVisits.set(host, visit);
  return visit;
}

async function visitInBackgroundTab(url: string): Promise<boolean> {
  const tab = await browser.tabs.create({ url, active: false });
  const tabId = tab.id;
  if (tabId === undefined) return false;

  try {
    return await new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(onUpdated);
        resolve(ok);
      };
      // The challenge runs at /_c and redirects back once passed — a finished
      // load anywhere else means the cookie is in place.
      const onUpdated = (id: number, info: { status?: string }, updated: { url?: string }) => {
        if (id !== tabId || info.status !== 'complete' || !updated.url) return;
        if (new URL(updated.url).pathname.startsWith('/_c')) return;
        finish(true);
      };
      const timer = setTimeout(() => finish(false), ACCESS_VISIT_TIMEOUT_MS);
      browser.tabs.onUpdated.addListener(onUpdated);
    });
  } finally {
    browser.tabs.remove(tabId).catch(() => {});
  }
}

/**
 * R1.5: Allowed destination hosts for cross-origin fetch from content scripts.
 * Mirrors manifest host_permissions — request to anything else is rejected.
 * Suffix matching lets subdomains through (e.g. mirror.mangalib.me).
 */
const ALLOWED_FETCH_HOST_SUFFIXES = [
  'mangalib.me',
  'mangalib.org',
  'hentailib.me',
  'lib.social',
  'cdnlibs.org',
  'imglib.info',
  'senkuro.com',
  'senkuro.me',
  'senkognito.com',
  'mangabuff.ru',
  'readmanga.io',
  'rmr.rocks',
  'zazaza.me',
  'one-way.work',
  'input.monster',
  'grouple.co',
  'inkstory.net',
  'manga.ovh',
  'static.inkstory.net',
  'com-x.life',
  'github.io',
];

function isAllowedFetchHost(urlString: string): boolean {
  try {
    const u = new URL(urlString);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_FETCH_HOST_SUFFIXES.some(
      (s) => host === s || host.endsWith('.' + s)
    );
  } catch {
    return false;
  }
}

/**
 * Handle fetch request from content script
 */
async function handleFetch(
  url: string,
  options?: RequestInit & { withCredentials?: boolean }
): Promise<{ data?: unknown; error?: string; status?: number; body?: string }> {
  if (!isAllowedFetchHost(url)) {
    return { error: 'Host not allowed' };
  }
  try {
    const { withCredentials, ...fetchOptions } = options || {};
    const response = await fetch(url, {
      ...fetchOptions,
      credentials: withCredentials ? 'include' : 'omit',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The status decides whether a retry can help; an HTML body is kept
      // because anti-bot challenges arrive as error pages (com-x sends 404).
      const isHtml = (response.headers.get('content-type') || '').includes('text/html');
      return {
        error: `HTTP ${response.status}: ${response.statusText}`,
        status: response.status,
        body: isHtml ? (await response.text()).slice(0, MAX_ERROR_BODY) : undefined,
      };
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
// F3.2: whitelist of allowed Referer values — content scripts can request only these
const ALLOWED_REFERERS = new Set<string>([
  'https://mangalib.me/',
  'https://hentailib.me/',
  'https://senkuro.me/',
  'https://senkuro.com/',
  'https://mangabuff.ru/',
  'https://inkstory.net/',
  'https://a.zazaza.me/',
]);

async function handleFetchImage(
  url: string,
  referer?: string
): Promise<{ data?: string; error?: string }> {
  if (!isAllowedFetchHost(url)) {
    return { error: 'Host not allowed' };
  }
  try {
    const headers: Record<string, string> = {};
    if (referer) {
      if (!ALLOWED_REFERERS.has(referer)) {
        return { error: 'Referer not allowed' };
      }
      headers['Referer'] = referer;
    }

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

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
 * Referer rules config — add new entries here as needed.
 * resourceTypes defaults to xmlhttprequest+other; override for images etc.
 */
const REFERER_RULES: Array<{
  urlFilter: string;
  referer: string;
  resourceTypes?: chrome.declarativeNetRequest.ResourceType[];
}> = [
  { urlFilter: '||cover.imglib.info/*', referer: 'https://mangalib.me/', resourceTypes: [browser.declarativeNetRequest.ResourceType.IMAGE] },
  { urlFilter: '||api.cdnlibs.org/*', referer: 'https://mangalib.me/' },
];

/**
 * Setup declarativeNetRequest rules to inject Referer headers.
 * Referer is a forbidden header in fetch(), so declarativeNetRequest is the only way.
 */
async function setupRefererRules() {
  try {
    const existingRules = await browser.declarativeNetRequest.getDynamicRules();
    const existingIds = existingRules.map((r) => r.id);

    if (existingIds.length > 0) {
      await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingIds,
      });
    }

    const addRules = REFERER_RULES.map((rule, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: browser.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          {
            header: 'Referer',
            operation: browser.declarativeNetRequest.HeaderOperation.SET,
            value: rule.referer,
          },
        ],
      },
      condition: {
        urlFilter: rule.urlFilter,
        resourceTypes: rule.resourceTypes ?? [
          browser.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
          browser.declarativeNetRequest.ResourceType.OTHER,
        ],
      },
    }));

    await browser.declarativeNetRequest.updateDynamicRules({ addRules });

    console.log('[Background] Referer rules configured:', addRules.length);
  } catch (error) {
    console.error('[Background] Failed to setup referer rules:', error);
  }
}
