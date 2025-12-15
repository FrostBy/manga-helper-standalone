/**
 * MangaPage - coordinator for manga page on MangaLib
 * Lifecycle + component injections, stores handle state
 */
import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { forwardRef } from 'preact/compat';
import { BasePage } from '@/src/pages';
import { waitForElement, triggerRawClick } from '@/src/utils/dom';
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { getAPI, mangalibAPI } from '@/src/api';
import { Logger } from '@/src/utils/logger';
import type { ChaptersResponse, PlatformKey } from '@/src/types';
import { PlatformButton, EditModal, ChapterStats } from '@/src/components';
import { createDropdownButton } from './templates';

export class MangaPage extends BasePage {
  // DOM elements
  private buttonContainer: HTMLElement | null = null;
  private modalContainer: HTMLElement | null = null;
  private chaptersTab: HTMLElement | null = null;
  private chaptersStatsContainer: HTMLElement | null = null;

  // Store subscriptions
  private unsubscribeStore: (() => void) | null = null;

  protected async initialize(): Promise<void> {
    // Wait for key DOM elements
    await Promise.all([
      waitForElement('.tabs-menu'),
      waitForElement('.fade.container .btns._group'),
    ]);

    const slug = this.getSlugFromUrl();

    // Initialize stores
    await useMappingsStore.getState().setContext(this.context.currentPlatform, slug);

    // Load manga data (stub - returns empty for now)
    const data = await this.fetchMangaData(slug);
    useMangaStore.getState().setMangaData(data);
  }

  async render(): Promise<void> {
    const tabsWrapper = document.querySelector('.tabs-menu');
    this.chaptersTab = tabsWrapper?.querySelectorAll('.tabs-item .tabs-item__inner')[1] as HTMLElement | null;

    // Select chapters tab
    if (this.chaptersTab) {
      this.selectTab(this.chaptersTab);
      this.renderChaptersInTab();
    }

    // Render platform button with dropdown
    this.renderPlatformButton();

    // Render modal
    this.renderModal();

    // Load data for each platform
    this.loadAllPlatformsData();

    // Subscribe to store changes
    this.subscribeToStoreChanges();
  }

  /**
   * Fetch manga data from current platform (MangaLib)
   */
  private async fetchMangaData(slug: string): Promise<{
    titles: string[];
    chapters: ChaptersResponse | null;
    lastChapterRead: number;
    freeChapters: number;
  }> {
    // Fetch in parallel
    const [titles, chapters, bookmark] = await Promise.all([
      mangalibAPI.getTitles(slug),
      mangalibAPI.getChapters(slug),
      mangalibAPI.getBookmark(slug),
    ]);

    // Count free chapters (no restricted_view or is_open: true)
    let freeChapters = 0;
    if (chapters?.data) {
      const freeList = chapters.data.filter((ch) => {
        const restricted = (ch as any).branches?.[0]?.restricted_view;
        return !restricted || restricted.is_open === true;
      });
      freeChapters = freeList.at(-1)?.number ?? 0;
    }

    return {
      titles: titles.length > 0 ? titles : [slug.replace(/-/g, ' ')],
      chapters,
      lastChapterRead: bookmark?.lastChapterRead ?? 0,
      freeChapters,
    };
  }

  /**
   * Render chapters info in tab
   * Format: "Chapters (total [read])" e.g. "Chapters (111 [75])"
   */
  private renderChaptersInTab(): void {
    if (!this.chaptersTab) return;

    const { chapters, lastChapterRead } = useMangaStore.getState();
    if (!chapters?.data?.length) return;

    const lastChapter = chapters.data.at(-1)?.number ?? 0;

    // Create container if not exists
    if (!this.chaptersStatsContainer) {
      this.chaptersStatsContainer = document.createElement('span');
      this.chaptersTab.appendChild(this.chaptersStatsContainer);
    }

    render(
      <> (<ChapterStats total={lastChapter} read={lastChapterRead} className="chapters-all" />)</>,
      this.chaptersStatsContainer
    );
  }

  /**
   * Render platform button with dropdown
   */
  private renderPlatformButton(): void {
    const buttonGroup = document.querySelector('.fade.container .btns._group');
    if (!buttonGroup) return;

    this.buttonContainer = document.createElement('div');
    this.buttonContainer.style.display = 'contents';
    buttonGroup.after(this.buttonContainer);

    render(
      <PlatformButton
        theme="dropdown"
        showOnMount={true}
        onRefresh={(key) => this.handleRefresh(key)}
        asChild
      >
        <NativeButton />
      </PlatformButton>,
      this.buttonContainer
    );
  }

  /**
   * Render edit modal
   */
  private renderModal(): void {
    this.modalContainer = document.createElement('div');
    const pageModals = document.querySelector('.page-modals');
    if (pageModals) {
      pageModals.appendChild(this.modalContainer);
    } else {
      document.body.appendChild(this.modalContainer);
    }

    render(
      <EditModal
        onSave={(key, url) => this.handleSaveLink(key, url)}
        onDelete={(key) => this.handleDeleteLink(key)}
      />,
      this.modalContainer
    );
  }

  /**
   * Load data for all other platforms
   */
  private async loadAllPlatformsData(): Promise<void> {
    const otherPlatforms = PlatformRegistry.getOthers(this.context.currentPlatform);

    for (const [platformKey] of otherPlatforms) {
      if (this.signal.aborted) return;
      this.loadPlatformData(platformKey);
    }
  }

  /**
   * Load data for a single platform
   */
  private async loadPlatformData(platformKey: PlatformKey): Promise<void> {
    if (this.signal.aborted) return;

    const store = useMappingsStore.getState();
    const api = getAPI(platformKey);

    try {
      // Check if we have a mapping already
      const { manualLinks, autoLinks } = store;
      const existingSlug = manualLinks[platformKey] ?? autoLinks[platformKey];

      if (existingSlug && typeof existingSlug === 'string') {
        // Have mapping - load cached or fetch fresh data
        let cached = await store.loadCachedResult(platformKey);

        if (!cached && 'getData' in api) {
          // Fetch fresh data
          const result = await (api as any).getData(existingSlug);
          if (result) {
            cached = await store.loadCachedResult(platformKey);
          }
        }
      } else if (existingSlug !== false) {
        // No mapping yet - search for manga
        const { titles } = useMangaStore.getState();
        if (titles.length > 0) {
          store.setLoading(platformKey, true);

          const result = await api.search(
            this.context.currentPlatform,
            store.currentSlug || '',
            titles,
            this.signal
          );

          store.setLoading(platformKey, false);

          if (result) {
            // Update autoLinks in store with found slug
            await store.saveAutoMapping(platformKey, result.slug);
            // Refresh cached results in store
            await store.loadCachedResult(platformKey);
          } else {
            // Save negative mapping to prevent re-search
            await store.saveAutoMapping(platformKey, false);
          }
        }
      }

      // Check if new chapters available
      this.checkNewChapters(platformKey);
    } catch (error) {
      store.setLoading(platformKey, false);
      Logger.error('MangaLibPage', `Error loading ${platformKey}`, error);
    }
  }

  /**
   * Check if platform has more chapters than current (free chapters)
   */
  private checkNewChapters(platformKey: PlatformKey): void {
    const { freeChapters } = useMangaStore.getState();
    const { cachedResults } = useMappingsStore.getState();

    const cached = cachedResults[platformKey];

    if (cached && cached.chapter > freeChapters) {
      useMangaStore.getState().setHasNewChapters(true);
    }
  }

  /**
   * Subscribe to store changes for chapters and hasNewChapters
   */
  private subscribeToStoreChanges(): void {
    // Cleanup previous subscription if exists (prevents leaks on double render)
    this.unsubscribeStore?.();

    this.unsubscribeStore = useMangaStore.subscribe((state, prevState) => {
      // Update chapters tab when chapters load
      if (state.chapters !== prevState.chapters) {
        this.renderChaptersInTab();
      }
      // Note: hasNewChapters is handled by PlatformButton component via store
    });
  }

  /**
   * Handle refresh button click
   */
  private handleRefresh = async (platformKey: PlatformKey): Promise<void> => {
    const store = useMappingsStore.getState();
    const { manualLinks, autoLinks } = store;
    const api = getAPI(platformKey);

    // Get target slug
    const targetSlug = manualLinks[platformKey] ?? autoLinks[platformKey];

    if (targetSlug && typeof targetSlug === 'string') {
      // Invalidate cache
      await store.invalidateCache(platformKey, targetSlug);

      // Fetch fresh data
      store.setLoading(platformKey, true);
      if ('getData' in api) {
        await (api as any).getData(targetSlug);
      }
      store.setLoading(platformKey, false);

      // Reload cached result into store
      await store.loadCachedResult(platformKey);
    } else {
      // No mapping or negative mapping - clear and re-search
      if (autoLinks[platformKey] === false) {
        // Clear negative mapping to allow re-search
        await store.deleteAutoMapping(platformKey);
      }
      await this.loadPlatformData(platformKey);
    }

    // Check for new chapters
    this.checkNewChapters(platformKey);
  };

  /**
   * Handle save link from modal
   */
  private handleSaveLink = async (platformKey: PlatformKey, url: string): Promise<void> => {
    const api = getAPI(platformKey);
    const extractedSlug = api.getSlugFromURL(url);
    if (!extractedSlug) return;

    const store = useMappingsStore.getState();

    // Save the manual link
    await store.saveManualLink(platformKey, extractedSlug);

    // Invalidate cache and reload data for this platform
    await store.invalidateCache(platformKey, extractedSlug);
    await this.loadPlatformData(platformKey);
  };

  /**
   * Handle delete link from modal
   */
  private handleDeleteLink = async (platformKey: PlatformKey): Promise<void> => {
    const store = useMappingsStore.getState();

    // Get current slug before deleting (for cache invalidation)
    const currentSlug = store.manualLinks[platformKey] ?? store.autoLinks[platformKey];

    // Delete both manual and auto links
    await store.deleteManualLink(platformKey);
    await store.deleteAutoMapping(platformKey);

    // Invalidate cache if we had a slug
    if (typeof currentSlug === 'string') {
      await store.invalidateCache(platformKey, currentSlug);
    }

    // Reload data for this platform (will try to search again)
    await this.loadPlatformData(platformKey);
  };

  /**
   * Select tab by triggering raw click (mouseup event)
   * MangaLib uses Vue which intercepts regular clicks
   */
  private selectTab(tab: HTMLElement): void {
    triggerRawClick(tab);

    // Some states require double click
    const state = document.querySelector('.fade.container .btns._group span')?.textContent?.trim();
    if (state === 'Reading' || state === 'Senkuro' || state === 'Readmanga' || state === 'Mangabuff') {
      triggerRawClick(tab);
    }
  }

  /**
   * Extract slug from current URL
   */
  private getSlugFromUrl(): string {
    return mangalibAPI.getSlugFromURL(window.location.href) || '';
  }

  async destroy(): Promise<void> {
    // Unsubscribe from store
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;

    // Always render(null) to trigger cleanup hooks, only check isConnected for remove()
    if (this.buttonContainer) {
      render(null, this.buttonContainer);
      if (this.buttonContainer.isConnected) {
        this.buttonContainer.remove();
      }
      this.buttonContainer = null;
    }

    if (this.modalContainer) {
      render(null, this.modalContainer);
      if (this.modalContainer.isConnected) {
        this.modalContainer.remove();
      }
      this.modalContainer = null;
    }

    if (this.chaptersStatsContainer) {
      render(null, this.chaptersStatsContainer);
      if (this.chaptersStatsContainer.isConnected) {
        this.chaptersStatsContainer.remove();
      }
      this.chaptersStatsContainer = null;
    }
    this.chaptersTab = null;

    // Reset stores
    useMangaStore.getState().reset();
    useMappingsStore.getState().reset();
  }
}

/**
 * Native MangaLib button - clones the existing button structure for native styling
 * Uses dangerouslySetInnerHTML to render cloned HTML, so Tippy attaches directly
 */
const NativeButton = forwardRef<HTMLDivElement>((_, ref) => {
  const hasNewChapters = useMangaStore((s) => s.hasNewChapters);

  // Clone button once and extract HTML
  const buttonData = useRef<{ className: string; innerHTML: string } | null>(null);
  if (!buttonData.current) {
    const cloned = createDropdownButton();
    buttonData.current = {
      className: cloned.className,
      innerHTML: cloned.innerHTML,
    };
  }

  return (
    <div
      ref={ref}
      className={`${buttonData.current.className}${hasNewChapters ? ' new' : ''}`}
      dangerouslySetInnerHTML={{ __html: buttonData.current.innerHTML }}
    />
  );
});
