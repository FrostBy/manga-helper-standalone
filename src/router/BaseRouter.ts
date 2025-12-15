/**
 * Base router for internal page routing
 * WXT handles domain matching, this handles path/query matching
 */
import type { BasePage } from '@/src/pages/BasePage';
import type { PageContext } from '@/src/pages/types';
import type { PlatformKey } from '@/src/types';
import type { RoutesConfig } from './types';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { Logger } from '@/src/utils/logger';

// Flag to prevent double-patching history
let historyPatched = false;
// Shared pathname tracking (prevents double-firing from polling + history)
let lastKnownPathname = '';

export abstract class BaseRouter {
  abstract readonly routes: RoutesConfig;
  abstract readonly platformKey: PlatformKey;

  private currentPage: BasePage | null = null;
  private currentAbortController: AbortController | null = null;
  private navigationListenerSetup = false;
  private navigationId = 0;

  // Store bound handlers for cleanup
  private boundInitHandler: (() => void) | null = null;

  // URL change tracking (shared between polling and history patch)
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * Hook for platform-specific initialization
   * Called before route matching
   */
  protected async preInit(): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Create page context with dependencies
   */
  private createPageContext(): PageContext {
    // Abort previous page's operations
    this.currentAbortController?.abort();
    this.currentAbortController = new AbortController();

    return {
      platforms: PlatformRegistry,
      currentPlatform: this.platformKey,
      abortController: this.currentAbortController,
    };
  }

  /**
   * Initialize router - match current URL and render page
   * Uses navigationId to handle rapid navigation (race condition protection)
   */
  async init(): Promise<void> {
    const currentNavId = ++this.navigationId;
    const pathname = window.location.pathname;

    Logger.debug('Router', `init() called`, { pathname, navId: currentNavId });

    await this.preInit();
    if (this.navigationId !== currentNavId) return;

    const query = Object.fromEntries(
      new URLSearchParams(window.location.search)
    );

    // Find matching route
    const route = Object.values(this.routes).find((route) => {
      if (typeof route.path === 'string') {
        return route.path === pathname;
      }
      return route.path(pathname, query);
    });

    const routeName = route ? Object.keys(this.routes).find(k => this.routes[k] === route) : null;
    Logger.debug('Router', `Route matched`, { pathname, route: routeName, hasCurrentPage: !!this.currentPage });

    // Destroy previous page before creating new one
    if (this.currentPage) {
      Logger.debug('Router', 'Destroying previous page');
      const pageToDestroy = this.currentPage;
      this.currentPage = null; // Clear reference BEFORE destroy to prevent double-destroy
      await pageToDestroy.destroy();
      Logger.debug('Router', 'Previous page destroyed');
      if (this.navigationId !== currentNavId) return;
    }

    if (route) {
      Logger.debug('Router', `Creating new page: ${routeName}`);
      const context = this.createPageContext();
      const page = await route.page.createInstance(context);
      if (this.navigationId !== currentNavId) {
        // Navigation superseded, cleanup orphaned page
        await page.destroy();
        return;
      }
      this.currentPage = page;
      await this.currentPage.render();
      Logger.debug('Router', `Page rendered: ${routeName}`);
    } else {
      Logger.debug('Router', 'No route matched, no page created');
    }
  }

  /**
   * Setup SPA navigation listener
   * Call this once after router creation
   */
  setupNavigationListener(): void {
    if (this.navigationListenerSetup) return;
    this.navigationListenerSetup = true;

    // Patch history methods only once (shared across all routers)
    if (!historyPatched) {
      this.patchHistory();
      historyPatched = true;
    }

    // Create bound handler for cleanup
    this.boundInitHandler = () => this.init();

    // Listen for navigation events
    window.addEventListener('locationchange', this.boundInitHandler);

    // URL polling fallback for SPAs that don't use history API
    // Uses shared lastKnownPathname to prevent double-firing with history patch
    lastKnownPathname = window.location.pathname;
    this.pollIntervalId = setInterval(() => {
      const currentPath = window.location.pathname;
      if (currentPath !== lastKnownPathname) {
        Logger.debug('Router', 'URL change detected (polling)', { from: lastKnownPathname, to: currentPath });
        lastKnownPathname = currentPath;
        window.dispatchEvent(new Event('locationchange'));
      }
    }, 300);
  }

  /**
   * Patch history.pushState and replaceState to dispatch locationchange event
   * Same approach as v1 - preserves 'this' context
   * Uses shared lastKnownPathname to prevent double-firing with polling
   */
  private patchHistory(): void {
    const oldPushState = history.pushState;
    history.pushState = function pushState(...args: [unknown, string, string?]) {
      const ret = oldPushState.apply(this, args);
      const newPathname = window.location.pathname;
      if (newPathname !== lastKnownPathname) {
        Logger.debug('Router', 'URL change detected (pushState)', { from: lastKnownPathname, to: newPathname });
        lastKnownPathname = newPathname;
        window.dispatchEvent(new Event('locationchange'));
      }
      return ret;
    };

    const oldReplaceState = history.replaceState;
    history.replaceState = function replaceState(...args: [unknown, string, string?]) {
      const ret = oldReplaceState.apply(this, args);
      const newPathname = window.location.pathname;
      if (newPathname !== lastKnownPathname) {
        Logger.debug('Router', 'URL change detected (replaceState)', { from: lastKnownPathname, to: newPathname });
        lastKnownPathname = newPathname;
        window.dispatchEvent(new Event('locationchange'));
      }
      return ret;
    };

    // Also listen for popstate (back/forward)
    window.addEventListener('popstate', () => {
      const newPathname = window.location.pathname;
      if (newPathname !== lastKnownPathname) {
        Logger.debug('Router', 'URL change detected (popstate)', { from: lastKnownPathname, to: newPathname });
        lastKnownPathname = newPathname;
        window.dispatchEvent(new Event('locationchange'));
      }
    });
  }

  /**
   * Cleanup router - remove event listeners and destroy current page
   */
  async destroy(): Promise<void> {
    // Stop URL polling
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }

    // Remove event listeners
    if (this.boundInitHandler) {
      window.removeEventListener('locationchange', this.boundInitHandler);
      this.boundInitHandler = null;
    }

    this.navigationListenerSetup = false;

    // Abort any ongoing operations
    this.currentAbortController?.abort();
    this.currentAbortController = null;

    // Destroy current page
    if (this.currentPage) {
      await this.currentPage.destroy();
      this.currentPage = null;
    }
  }
}
