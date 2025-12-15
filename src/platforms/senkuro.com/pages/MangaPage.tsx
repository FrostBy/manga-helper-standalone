/**
 * MangaPage for Senkuro
 * Similar to MangaLib but with Senkuro-specific UI integration
 */
import { render } from 'preact';
import { BasePage } from '@/src/pages';
import { waitForElement, t } from '@/src/utils';
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { getAPI, senkuroAPI } from '@/src/api';
import { Logger } from '@/src/utils/logger';
import type { PlatformKey } from '@/src/types';
import { PlatformButton, EditModal, ChapterStats } from '@/src/components';

export class MangaPage extends BasePage {
  // DOM containers for Preact components
  private buttonContainer: HTMLElement | null = null;
  private modalContainer: HTMLElement | null = null;
  private chaptersTab: HTMLElement | null = null;
  private chaptersStatsContainer: HTMLElement | null = null;

  // Store subscriptions
  private unsubscribeStore: (() => void) | null = null;

  protected async initialize(): Promise<void> {
    // Wait for project-nav to appear (contains action buttons)
    await waitForElement('article.project-nav');

    const slug = this.getSlugFromUrl();

    // Initialize stores
    await useMappingsStore.getState().setContext(this.context.currentPlatform, slug);

    // Load manga data
    const data = await this.fetchMangaData(slug);
    useMangaStore.getState().setMangaData(data);
  }

  async render(): Promise<void> {
    // Wait for chapters tab (React SPA - elements may render later)
    this.chaptersTab = await waitForElement<HTMLElement>('a[href*="/chapters"].tabs-tab span');
    this.renderChaptersInTab();

    // Render platform button (waits for bookmark button inside)
    await this.renderPlatformButton();

    // Render modal
    this.renderModal();

    // Load data for each platform
    this.loadAllPlatformsData();

    // Subscribe to store changes
    this.subscribeToStoreChanges();
  }

  /**
   * Render chapters stats in tab
   */
  private renderChaptersInTab(): void {
    if (!this.chaptersTab) return;

    const { chapters, lastChapterRead } = useMangaStore.getState();
    if (!chapters?.data?.length) return;

    const lastChapter = chapters.data.at(-1)?.number ?? 0;

    if (!this.chaptersStatsContainer) {
      this.chaptersStatsContainer = document.createElement('span');
      this.chaptersStatsContainer.style.marginLeft = '6px';
      this.chaptersTab.after(this.chaptersStatsContainer);
    }

    render(
      <ChapterStats total={lastChapter} read={lastChapterRead} className="chapters-all" />,
      this.chaptersStatsContainer
    );
  }

  /**
   * Subscribe to store changes
   */
  private subscribeToStoreChanges(): void {
    // Cleanup previous subscription if exists (prevents leaks on double render)
    this.unsubscribeStore?.();

    this.unsubscribeStore = useMangaStore.subscribe((state, prevState) => {
      if (state.chapters !== prevState.chapters) {
        this.renderChaptersInTab();
      }
    });
  }

  /**
   * Fetch manga data from Senkuro
   */
  private async fetchMangaData(slug: string) {
    const [manga, chapters, bookmark] = await Promise.all([
      senkuroAPI.getManga(slug),
      senkuroAPI.getChapters(slug),
      senkuroAPI.getBookmark(slug),
    ]);

    const titles: string[] = [];
    if (manga?.name) titles.push(manga.name);
    if (manga?.otherNames) titles.push(...manga.otherNames);

    const lastChapter = chapters?.data?.at(-1)?.number ?? 0;

    return {
      titles: titles.length > 0 ? titles : [slug.replace(/-/g, ' ')],
      chapters,
      lastChapterRead: bookmark?.lastChapterRead ?? 0,
      freeChapters: lastChapter, // Senkuro doesn't have paid chapters
    };
  }

  /**
   * Render platform button with dropdown
   */
  private async renderPlatformButton(): Promise<void> {
    // Wait for bookmark button wrapper (v-popper with "Читаю")
    const bookmarkWrapper = await waitForElement('article.project-nav .v-popper--theme-dropdown');
    if (!bookmarkWrapper) return;

    // Create container after bookmark wrapper
    this.buttonContainer = document.createElement('div');
    this.buttonContainer.className = 'platforms-wrapper v-popper';
    this.buttonContainer.style.cssText = 'flex: 1 1 auto;';
    bookmarkWrapper.after(this.buttonContainer);

    render(
      <PlatformButton
        theme="senkuro"
        showOnMount={true}
        onRefresh={(key) => this.handleRefresh(key)}
        className="button button--secondary button--fluid button-size--big"
      >
        <PlatformsIcon />
        <span>{t('otherSites')}</span>
      </PlatformButton>,
      this.buttonContainer
    );
  }

  /**
   * Render edit modal
   */
  private renderModal(): void {
    this.modalContainer = document.createElement('div');
    document.body.appendChild(this.modalContainer);

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
      const { manualLinks, autoLinks } = store;
      const existingSlug = manualLinks[platformKey] ?? autoLinks[platformKey];

      if (existingSlug && typeof existingSlug === 'string') {
        let cached = await store.loadCachedResult(platformKey);

        if (!cached && 'getData' in api) {
          const result = await (api as any).getData(existingSlug);
          if (result) {
            await store.loadCachedResult(platformKey);
          }
        }
      } else if (existingSlug !== false) {
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
            await store.saveAutoMapping(platformKey, result.slug);
            // Fetch data to cache it
            if ('getData' in api) {
              await (api as any).getData(result.slug);
            }
            await store.loadCachedResult(platformKey);
          } else {
            await store.saveAutoMapping(platformKey, false);
          }
        }
      }
    } catch (error) {
      store.setLoading(platformKey, false);
      Logger.error('SenkuroPage', `Error loading ${platformKey}`, error);
    }
  }

  /**
   * Handle refresh button click
   */
  private handleRefresh = async (platformKey: PlatformKey): Promise<void> => {
    const store = useMappingsStore.getState();
    const { manualLinks, autoLinks } = store;
    const api = getAPI(platformKey);

    const targetSlug = manualLinks[platformKey] ?? autoLinks[platformKey];

    if (targetSlug && typeof targetSlug === 'string') {
      await store.invalidateCache(platformKey, targetSlug);
      store.setLoading(platformKey, true);
      if ('getData' in api) {
        await (api as any).getData(targetSlug);
      }
      store.setLoading(platformKey, false);
      await store.loadCachedResult(platformKey);
    } else {
      if (autoLinks[platformKey] === false) {
        await store.deleteAutoMapping(platformKey);
      }
      await this.loadPlatformData(platformKey);
    }
  };

  /**
   * Handle save link from modal
   */
  private handleSaveLink = async (platformKey: PlatformKey, url: string): Promise<void> => {
    const api = getAPI(platformKey);
    const extractedSlug = api.getSlugFromURL(url);
    if (!extractedSlug) return;

    const store = useMappingsStore.getState();
    await store.saveManualLink(platformKey, extractedSlug);
    await store.invalidateCache(platformKey, extractedSlug);
    await this.loadPlatformData(platformKey);
  };

  /**
   * Handle delete link from modal
   */
  private handleDeleteLink = async (platformKey: PlatformKey): Promise<void> => {
    const store = useMappingsStore.getState();
    const currentSlug = store.manualLinks[platformKey] ?? store.autoLinks[platformKey];

    await store.deleteManualLink(platformKey);
    await store.deleteAutoMapping(platformKey);

    if (typeof currentSlug === 'string') {
      await store.invalidateCache(platformKey, currentSlug);
    }

    await this.loadPlatformData(platformKey);
  };

  /**
   * Extract slug from current URL
   */
  private getSlugFromUrl(): string {
    return senkuroAPI.getSlugFromURL(window.location.href) || '';
  }

  async destroy(): Promise<void> {
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

    useMangaStore.getState().reset();
  }
}

/**
 * Icon for platforms button (grid icon)
 */
function PlatformsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" style={{ width: '20px', height: '20px' }}>
      <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"/>
    </svg>
  );
}
