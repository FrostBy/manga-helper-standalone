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
import { mangalibAPI } from '@/src/api';
import type { MangaLibChapter } from '@/src/api/mangalib';
import {
  loadAllPlatformsData,
  handleRefresh as doRefresh,
  handleSaveLink as doSaveLink,
  handleDeleteLink as doDeleteLink,
} from '@/src/utils/platformActions';
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
    loadAllPlatformsData(
      this.context.currentPlatform,
      Array.from(PlatformRegistry.getOthers(this.context.currentPlatform).keys()),
      this.signal,
      { loggerContext: 'MangaLibPage', onLoaded: (k) => this.checkNewChapters(k) }
    );

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
        const restricted = (ch as MangaLibChapter).branches?.[0]?.restricted_view;
        return !restricted || restricted.is_open === true;
      });
      const last = freeList.at(-1) as MangaLibChapter | undefined;
      freeChapters = Number(last?.item_number) || Number(last?.number) || 0;
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

    const last = chapters.data.at(-1) as MangaLibChapter | undefined;
    const lastChapter = Number(last?.item_number) || Number(last?.number) || 0;

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
        onRefresh={(key) => doRefresh(this.context.currentPlatform, key, this.signal, { loggerContext: 'MangaLibPage', onLoaded: (k) => this.checkNewChapters(k) })}
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
        onSave={(key, url) => doSaveLink(this.context.currentPlatform, key, url, this.signal, { loggerContext: 'MangaLibPage', onLoaded: (k) => this.checkNewChapters(k) })}
        onDelete={(key) => doDeleteLink(this.context.currentPlatform, key, this.signal, { loggerContext: 'MangaLibPage', onLoaded: (k) => this.checkNewChapters(k) })}
      />,
      this.modalContainer
    );
  }

  /**
   * Check if platform has more chapters than current (free chapters)
   */
  private checkNewChapters(platformKey: PlatformKey): void {
    const { freeChapters } = useMangaStore.getState();
    const { cachedResults, offsets } = useMappingsStore.getState();

    const cached = cachedResults[platformKey];
    const offset = offsets[platformKey] ?? 0;

    if (cached && cached.chapter + offset > freeChapters) {
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
