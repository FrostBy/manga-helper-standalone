/**
 * MangaPage for Inkstory
 * Uses native Tailwind classes from the site
 */
import { render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { BasePage } from '@/src/pages';
import { waitForElement, t } from '@/src/utils';
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { getAPI, inkstoryAPI } from '@/src/api';
import { Logger } from '@/src/utils/logger';
import type { PlatformKey } from '@/src/types';
import { PlatformDropdown, EditModal, ChapterStats } from '@/src/components';

export class MangaPage extends BasePage {
  private buttonContainer: HTMLElement | null = null;
  private modalContainer: HTMLElement | null = null;
  private chaptersTab: HTMLElement | null = null;
  private chaptersBadge: HTMLElement | null = null;
  private chaptersStatsContainer: HTMLElement | null = null;
  private unsubscribeStore: (() => void) | null = null;

  protected async initialize(): Promise<void> {
    await waitForElement('[component-export="BookPosterWithCovers"]');

    const slug = this.getSlugFromUrl();
    await useMappingsStore.getState().setContext(this.context.currentPlatform, slug);

    const data = await this.fetchMangaData(slug);
    useMangaStore.getState().setMangaData(data);
  }

  async render(): Promise<void> {
    await this.findChaptersTab();
    this.selectChaptersTab();
    this.renderChaptersInTab();
    await this.renderPlatformButton();
    this.renderModal();
    this.loadAllPlatformsData();
    this.subscribeToStoreChanges();
  }

  private selectChaptersTab(): void {
    if (this.chaptersTab) {
      this.chaptersTab.click();
    }
  }

  private async findChaptersTab(): Promise<void> {
    const tabsContainer = await waitForElement('[component-export="FlexibleTabs"]');
    Logger.debug('Inkstory', 'findChaptersTab', { tabsContainer: !!tabsContainer });
    if (!tabsContainer) return;

    // Find tab with text "Главы"
    const tabs = tabsContainer.querySelectorAll('.flex.flex-col.gap-1');
    Logger.debug('Inkstory', 'tabs found', { count: tabs.length });
    for (const tab of tabs) {
      if (tab.textContent?.includes('Главы')) {
        this.chaptersTab = tab.querySelector('.flex.gap-2.items-center') as HTMLElement;
        this.chaptersBadge = this.chaptersTab?.querySelector(':scope > div') as HTMLElement;
        Logger.debug('Inkstory', 'chaptersTab found', { chaptersTab: !!this.chaptersTab, chaptersBadge: !!this.chaptersBadge });
        break;
      }
    }
  }

  private renderChaptersInTab(): void {
    const { lastChapterRead } = useMangaStore.getState();
    Logger.debug('Inkstory', 'renderChaptersInTab', { chaptersBadge: !!this.chaptersBadge, lastChapterRead });
    if (!this.chaptersBadge) return;
    if (!lastChapterRead) return;

    // Delay to let site finish re-rendering tabs
    setTimeout(() => {
      if (!this.chaptersBadge) return;

      if (!this.chaptersStatsContainer) {
        this.chaptersStatsContainer = document.createElement('span');
        this.chaptersStatsContainer.className = 'ml-1 opacity-70';
        this.chaptersBadge.appendChild(this.chaptersStatsContainer);
      }

      render(<>[{lastChapterRead}]</>, this.chaptersStatsContainer);
    }, 200);
  }

  private async fetchMangaData(slug: string) {
    const manga = inkstoryAPI.parseMangaHTML(document.documentElement.outerHTML);

    const titles: string[] = [];
    if (manga?.name) titles.push(manga.name);
    if (manga?.otherNames) titles.push(...manga.otherNames);

    // Parse lastChapterRead from captured astro state (DOM)
    const lastChapterRead = this.parseLastChapterRead();

    return {
      titles: titles.length > 0 ? titles : [slug.replace(/-/g, ' ')],
      chapters: null,
      lastChapterRead,
      freeChapters: 0,
    };
  }

  private parseLastChapterRead(): number {
    const data = window.__inkstoryAstroState;
    Logger.debug('Inkstory', 'parseLastChapterRead', { hasData: !!data, isArray: Array.isArray(data) });
    if (!Array.isArray(data)) return 0;

    const bookmarkChapters: number[] = [];
    for (const item of data) {
      if (item && typeof item === 'object' && !Array.isArray(item) && 'chapter' in item && 'userId' in item) {
        const chapterIdx = (item as Record<string, unknown>).chapter;
        if (typeof chapterIdx === 'number') {
          const chapterData = data[chapterIdx] as Record<string, unknown> | undefined;
          if (chapterData && typeof chapterData === 'object' && 'number' in chapterData) {
            const numIdx = chapterData.number;
            if (typeof numIdx === 'number' && typeof data[numIdx] === 'number') {
              bookmarkChapters.push(data[numIdx] as number);
            }
          }
        }
      }
    }

    return bookmarkChapters.length > 0 ? Math.max(...bookmarkChapters) : 0;
  }

  private async renderPlatformButton(): Promise<void> {
    const targetDiv = await waitForElement('[component-export="BookPosterWithCovers"] + div');
    if (!targetDiv) return;

    this.buttonContainer = document.createElement('div');
    this.buttonContainer.className = 'mt-3';
    targetDiv.appendChild(this.buttonContainer);

    render(
      <InkstoryPlatformButton
        onRefresh={(key) => this.handleRefresh(key)}
      />,
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
    this.unsubscribeStore = useMangaStore.subscribe((state, prevState) => {
      if (state.lastChapterRead !== prevState.lastChapterRead) {
        this.renderChaptersInTab();
      }
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
      Logger.error('InkstoryPage', `Error loading ${platformKey}`, error);
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
    return inkstoryAPI.getSlugFromURL(window.location.href) || '';
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
    this.chaptersBadge = null;

    useMangaStore.getState().reset();
  }
}

/**
 * Inkstory Platform Button with native Tailwind dropdown
 */
function InkstoryPlatformButton({ onRefresh }: { onRefresh: (key: PlatformKey) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hasNewChapters = useMangaStore((s) => s.hasNewChapters);

  // Handle open/close with animation
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else if (isVisible) {
      // Wait for close animation
      const timer = setTimeout(() => setIsVisible(false), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const modal = document.getElementById('edit-link-modal');
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        (!modal || !modal.contains(target))
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Calculate dropdown position
  const getDropdownStyle = () => {
    if (!buttonRef.current) return {};
    const rect = buttonRef.current.getBoundingClientRect();
    return {
      position: 'fixed' as const,
      left: `${rect.left}px`,
      top: `${rect.bottom + 4}px`,
      zIndex: 50,
      minWidth: `${rect.width}px`,
    };
  };

  return (
    <>
      {/* Button - matches site's style */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center cursor-pointer gap-2 whitespace-nowrap rounded-md transition-all font-medium border bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 h-9 px-3 text-sm justify-center w-full ${hasNewChapters ? 'ring-2 ring-green-500' : ''}`}
      >
        <PlatformsIcon />
        <span>{t('otherSites')}</span>
      </button>

      {/* Dropdown - rendered to body */}
      {isVisible && (
        <div style={getDropdownStyle()} ref={dropdownRef}>
          <div
            data-state={isOpen ? 'open' : 'closed'}
            data-side="bottom"
            className="inkstory-dropdown z-50 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 min-w-[250px] [&_svg]:size-4 [&_svg]:shrink-0"
          >
            <PlatformDropdown onRefresh={onRefresh} />
          </div>
        </div>
      )}
    </>
  );
}

function PlatformsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
    >
      <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z" />
    </svg>
  );
}
