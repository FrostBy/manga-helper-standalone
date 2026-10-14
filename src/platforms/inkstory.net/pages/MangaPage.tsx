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
import { collectTitles } from '@/src/utils/manga';
import {
  loadAllPlatformsData,
  handleRefresh as doRefresh,
  handleSaveLink as doSaveLink,
  handleDeleteLink as doDeleteLink,
} from '@/src/utils/platformActions';
import type { PlatformKey } from '@/src/types';
import { PlatformDropdown, EditModal } from '@/src/components';

const BUTTONS_SELECTOR = '[class*="aspect-5/7"] + div';

/**
 * Title tabs are separate URLs and every tab re-creates the page. Jumping to
 * "Главы" and opening the dropdown on each would trap the user on that tab and
 * pop the dropdown on every tab click — both happen once per title.
 */
let lastTitleSlug = '';

export class MangaPage extends BasePage {
  private buttonContainer: HTMLElement | null = null;
  private modalContainer: HTMLElement | null = null;
  private chaptersTab: HTMLElement | null = null;
  private chaptersStatsContainer: HTMLElement | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private openDropdown = false;

  protected async initialize(): Promise<void> {
    await waitForElement(BUTTONS_SELECTOR);

    const slug = this.getSlugFromUrl();
    this.chaptersTab = document.querySelector<HTMLElement>('a[role="tab"][href$="/chapters"]');
    const onInfoTab = !/\/content\/[^/]+\/./.test(window.location.pathname);
    if (slug !== lastTitleSlug && onInfoTab && this.chaptersTab) {
      // Not recorded: the "Главы" page it lands on is the visit that opens the dropdown.
      this.chaptersTab.click();
    } else {
      this.openDropdown = slug !== lastTitleSlug;
      lastTitleSlug = slug;
    }

    await useMappingsStore.getState().setContext(this.context.currentPlatform, slug);

    const data = await this.fetchMangaData(slug);
    useMangaStore.getState().setMangaData(data);
  }

  async render(): Promise<void> {
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

  private renderChaptersInTab(): void {
    const { lastChapterRead } = useMangaStore.getState();
    if (!this.chaptersTab) return;
    if (!lastChapterRead) return;

    // Delay to let site finish re-rendering tabs
    setTimeout(() => {
      if (!this.chaptersTab) return;

      if (!this.chaptersStatsContainer) {
        this.chaptersStatsContainer = document.createElement('span');
        this.chaptersStatsContainer.className = 'ml-1 opacity-80';
        this.chaptersTab.appendChild(this.chaptersStatsContainer);
      }

      render(<>[{lastChapterRead}]</>, this.chaptersStatsContainer);
    }, 200);
  }

  private async fetchMangaData(slug: string) {
    const [manga, data] = await Promise.all([inkstoryAPI.getManga(slug), inkstoryAPI.getMangaData(slug)]);
    const titles = collectTitles(manga);

    return {
      titles: titles.length > 0 ? titles : [slug.replace(/-/g, ' ')],
      chapters: null,
      lastChapterRead: data?.lastChapterRead ?? 0,
      freeChapters: 0,
    };
  }

  private async renderPlatformButton(): Promise<void> {
    const targetDiv = await waitForElement(BUTTONS_SELECTOR);
    if (!targetDiv) return;

    this.buttonContainer = document.createElement('div');
    targetDiv.appendChild(this.buttonContainer);

    render(
      <InkstoryPlatformButton
        openOnMount={this.openDropdown}
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

    useMangaStore.getState().reset();
  }
}

/**
 * Inkstory Platform Button with native Tailwind dropdown
 */
function InkstoryPlatformButton({
  openOnMount,
  onRefresh,
}: {
  openOnMount: boolean;
  onRefresh: (key: PlatformKey) => void;
}) {
  const [isOpen, setIsOpen] = useState(openOnMount);
  const [isVisible, setIsVisible] = useState(openOnMount);
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

  // Anchored to the button, not `fixed` at its coordinates: the dropdown opens
  // on load, and a fixed one would stay behind when the page scrolls or shifts.
  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 h-8 gap-1.5 px-2.5 w-full ${hasNewChapters ? 'ring-2 ring-green-500' : ''}`}
      >
        <PlatformsIcon />
        <span>{t('otherSites')}</span>
      </button>

      {isVisible && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50 }} ref={dropdownRef}>
          <div
            data-open={isOpen ? '' : undefined}
            data-closed={isOpen ? undefined : ''}
            data-side="bottom"
            className="inkstory-dropdown z-50 min-w-62 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <PlatformDropdown onRefresh={onRefresh} />
          </div>
        </div>
      )}
    </div>
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
