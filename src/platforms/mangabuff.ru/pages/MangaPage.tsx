/**
 * MangaPage for MangaBuff
 * Uses native Tippy (dropdown theme) and site's button styles
 */
import { render } from 'preact';
import { BasePage } from '@/src/pages';
import { waitForElement, t } from '@/src/utils';
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { mangabuffAPI } from '@/src/api';
import {
  loadAllPlatformsData,
  handleRefresh as doRefresh,
  handleSaveLink as doSaveLink,
  handleDeleteLink as doDeleteLink,
} from '@/src/utils/platformActions';
import { userProgress } from '@/src/utils/storage';
import type { PlatformKey } from '@/src/types';
import { PlatformButton, EditModal } from '@/src/components';

export class MangaPage extends BasePage {
  private buttonContainer: HTMLElement | null = null;
  private modalContainer: HTMLElement | null = null;
  private chaptersTab: HTMLElement | null = null;
  private chaptersStatsContainer: HTMLElement | null = null;
  private unsubscribeStore: (() => void) | null = null;

  protected async initialize(): Promise<void> {
    await waitForElement('.manga__poster');

    const slug = this.getSlugFromUrl();
    await useMappingsStore.getState().setContext(this.context.currentPlatform, slug);

    const data = await this.fetchMangaData(slug);
    useMangaStore.getState().setMangaData(data);
  }

  async render(): Promise<void> {
    // Chapters tab - click to activate and add read count
    this.chaptersTab = document.querySelector<HTMLElement>('button[data-page="chapters"]');
    this.selectChaptersTab();
    this.renderChaptersInTab();

    // Platform button in .manga__poster
    await this.renderPlatformButton();

    // Modal
    this.renderModal();

    // Load other platforms
    loadAllPlatformsData(
      this.context.currentPlatform,
      Array.from(PlatformRegistry.getOthers(this.context.currentPlatform).keys()),
      this.signal,
      { loggerContext: 'MangaBuffPage' }
    );

    // Subscribe to store
    this.subscribeToStoreChanges();
  }

  private async fetchMangaData(slug: string) {
    const manga = mangabuffAPI.parseMangaHTML(document.documentElement.outerHTML);
    const [chapters, lastChapterRead] = await Promise.all([
      mangabuffAPI.getChapters(slug),
      userProgress.get('mangabuff', slug),
    ]);

    const titles: string[] = [];
    if (manga?.name) titles.push(manga.name);
    if (manga?.otherNames) titles.push(...manga.otherNames);

    const lastChapter = chapters?.data?.at(-1)?.number ?? 0;

    return {
      titles: titles.length > 0 ? titles : [slug.replace(/-/g, ' ')],
      chapters,
      lastChapterRead,
      freeChapters: lastChapter,
    };
  }

  private renderChaptersInTab(): void {
    if (!this.chaptersTab) return;

    const { lastChapterRead } = useMangaStore.getState();
    if (!lastChapterRead) return;

    if (!this.chaptersStatsContainer) {
      this.chaptersStatsContainer = document.createElement('span');
      this.chaptersStatsContainer.style.opacity = '0.7';
      this.chaptersStatsContainer.style.marginLeft = '4px';
      this.chaptersTab.appendChild(this.chaptersStatsContainer);
    }

    render(<span>[{lastChapterRead}]</span>, this.chaptersStatsContainer);
  }

  private selectChaptersTab(): void {
    if (this.chaptersTab && !this.chaptersTab.classList.contains('tabs__item--active')) {
      this.chaptersTab.click();
    }
  }

  private async renderPlatformButton(): Promise<void> {
    const reportBlock = await waitForElement('.manga__report');
    if (!reportBlock) return;

    this.buttonContainer = document.createElement('div');
    this.buttonContainer.className = 'manga__controls dropdown';
    this.buttonContainer.style.marginTop = '12px';
    reportBlock.before(this.buttonContainer);

    const container = this.buttonContainer;
    render(
      <PlatformButton
        theme="dropdown"
    placement="bottom-start"
    appendTo={() => container}
    zIndex={9999}
    animation="fade"
    showOnMount={true}
    onRefresh={(key) => doRefresh(this.context.currentPlatform, key, this.signal, { loggerContext: 'MangaBuffPage' })}
    className="button w-100 dropdown__trigger"
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
        onSave={(key, url) => doSaveLink(this.context.currentPlatform, key, url, this.signal, { loggerContext: 'MangaBuffPage' })}
    onDelete={(key) => doDeleteLink(this.context.currentPlatform, key, this.signal, { loggerContext: 'MangaBuffPage' })}
    />,
    this.modalContainer
  );
  }

  private subscribeToStoreChanges(): void {
    this.unsubscribeStore?.();

    this.unsubscribeStore = useMangaStore.subscribe((state, prevState) => {
      if (state.chapters !== prevState.chapters || state.lastChapterRead !== prevState.lastChapterRead) {
        this.renderChaptersInTab();
      }
    });
  }

  private getSlugFromUrl(): string {
    return mangabuffAPI.getSlugFromURL(window.location.href) || '';
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

function PlatformsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" style={{ width: '18px', height: '18px' }}>
  <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"/>
    </svg>
);
}
