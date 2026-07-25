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
import { inkstoryAPI } from '@/src/api';
import { parseAstroState } from '@/src/api/inkstory';
import { Logger } from '@/src/utils/logger';
import {
  loadAllPlatformsData,
  handleRefresh as doRefresh,
  handleSaveLink as doSaveLink,
  handleDeleteLink as doDeleteLink,
} from '@/src/utils/platformActions';
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
    loadAllPlatformsData(
      this.context.currentPlatform,
      Array.from(PlatformRegistry.getOthers(this.context.currentPlatform).keys()),
      this.signal,
      { loggerContext: 'InkstoryPage' }
    );
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

  /**
   * Reading position from the captured page state — shares the API's parser so
   * the badge cannot drift from what the dropdown shows on other platforms.
   */
  private parseLastChapterRead(): number {
    const data = window.__inkstoryAstroState;
    Logger.debug('Inkstory', 'parseLastChapterRead', { hasData: !!data, isArray: Array.isArray(data) });
    if (!Array.isArray(data)) return 0;

    return parseAstroState(data).lastChapterRead;
  }

  private async renderPlatformButton(): Promise<void> {
    const targetDiv = await waitForElement('[component-export="BookPosterWithCovers"] + div');
    if (!targetDiv) return;

    this.buttonContainer = document.createElement('div');
    this.buttonContainer.className = 'mt-3';
    targetDiv.appendChild(this.buttonContainer);

    render(
      <InkstoryPlatformButton
        onRefresh={(key) => doRefresh(this.context.currentPlatform, key, this.signal, { loggerContext: 'InkstoryPage' })}
      />,
      this.buttonContainer
    );
  }

  private renderModal(): void {
    this.modalContainer = document.createElement('div');
    document.body.appendChild(this.modalContainer);

    render(
      <EditModal
        onSave={(key, url) => doSaveLink(this.context.currentPlatform, key, url, this.signal, { loggerContext: 'InkstoryPage' })}
        onDelete={(key) => doDeleteLink(this.context.currentPlatform, key, this.signal, { loggerContext: 'InkstoryPage' })}
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
