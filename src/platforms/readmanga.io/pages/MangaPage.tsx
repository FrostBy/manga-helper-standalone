/**
 * MangaPage for ReadManga
 * Uses Bootstrap button styles from the site
 */
import { render } from 'preact';
import { BasePage } from '@/src/pages';
import { waitForElement, t } from '@/src/utils';
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { getAPI, readmangaAPI } from '@/src/api';
import { Logger } from '@/src/utils/logger';
import type { PlatformKey } from '@/src/types';
import { PlatformButton, EditModal } from '@/src/components';

export class MangaPage extends BasePage {
  private buttonContainer: HTMLElement | null = null;
  private modalContainer: HTMLElement | null = null;
  private unsubscribeStore: (() => void) | null = null;

  protected async initialize(): Promise<void> {
    Logger.debug('ReadManga', 'initialize started');
    await waitForElement('.read-first-chapter');
    Logger.debug('ReadManga', 'read-first-chapter found');

    const slug = this.getSlugFromUrl();
    Logger.debug('ReadManga', 'slug', slug);
    await useMappingsStore.getState().setContext(this.context.currentPlatform, slug);

    const data = await this.fetchMangaData(slug);
    Logger.debug('ReadManga', 'fetchMangaData result', data);
    useMangaStore.getState().setMangaData(data);
  }

  async render(): Promise<void> {
    Logger.debug('ReadManga', 'render started');
    await this.renderPlatformButton();
    Logger.debug('ReadManga', 'renderPlatformButton done');
    this.renderModal();
    this.loadAllPlatformsData();
    this.subscribeToStoreChanges();
  }

  private async fetchMangaData(slug: string) {
    const manga = readmangaAPI.parseMangaHTML(document.documentElement.outerHTML);
    const data = await readmangaAPI.getData(slug);

    const titles: string[] = [];
    if (manga?.name) titles.push(manga.name);
    if (manga?.otherNames) titles.push(...manga.otherNames);

    return {
      titles: titles.length > 0 ? titles : [slug.replace(/_/g, ' ')],
      chapters: null,
      lastChapterRead: data?.lastChapterRead ?? 0,
      freeChapters: data?.chapter ?? 0,
    };
  }

  private async renderPlatformButton(): Promise<void> {
    const readFirstChapter = await waitForElement('.read-first-chapter');
    if (!readFirstChapter) return;

    this.buttonContainer = document.createElement('div');
    this.buttonContainer.style.marginTop = '8px';
    readFirstChapter.after(this.buttonContainer);

    const container = this.buttonContainer;
    render(
      <PlatformButton
        theme="dropdown"
        placement="bottom-start"
        appendTo={() => container}
        zIndex={9999}
        animation="fade"
        showOnMount={true}
        injectCSS={true}
        onRefresh={(key) => this.handleRefresh(key)}
        className="btn btn-outline-secondary btn-lg btn-block"
      >
        <PlatformsIcon />
        <span style={{ marginLeft: '8px' }}>{t('otherSites')}</span>
      </PlatformButton>,
      this.buttonContainer
    );
  }

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

  private subscribeToStoreChanges(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = useMangaStore.subscribe(() => {
      // Re-render if needed
    });
  }

  private async loadAllPlatformsData(): Promise<void> {
    const otherPlatforms = PlatformRegistry.getOthers(this.context.currentPlatform);

    for (const [platformKey] of otherPlatforms) {
      if (this.signal.aborted) return;
      this.loadPlatformData(platformKey);
    }
  }

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
      Logger.error('ReadMangaPage', `Error loading ${platformKey}`, error);
    }
  }

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

  private handleSaveLink = async (platformKey: PlatformKey, url: string): Promise<void> => {
    const api = getAPI(platformKey);
    const extractedSlug = api.getSlugFromURL(url);
    if (!extractedSlug) return;

    const store = useMappingsStore.getState();
    await store.saveManualLink(platformKey, extractedSlug);
    await store.invalidateCache(platformKey, extractedSlug);
    await this.loadPlatformData(platformKey);
  };

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

  private getSlugFromUrl(): string {
    return readmangaAPI.getSlugFromURL(window.location.href) || '';
  }

  async destroy(): Promise<void> {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;

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

    useMangaStore.getState().reset();
  }
}

function PlatformsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" style={{ width: '18px', height: '18px' }}>
      <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"/>
    </svg>
  );
}
