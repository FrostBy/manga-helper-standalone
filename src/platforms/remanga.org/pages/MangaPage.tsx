/**
 * MangaPage for Remanga — the button and menu wear the site's own classes:
 * its theme colours exist only as its utility classes.
 */
import { render } from 'preact';
import { BasePage } from '@/src/pages';
import { waitForElement, t } from '@/src/utils';
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { remangaAPI } from '@/src/api';
import { collectTitles } from '@/src/utils/manga';
import {
  loadAllPlatformsData,
  handleRefresh as doRefresh,
  handleSaveLink as doSaveLink,
  handleDeleteLink as doDeleteLink,
} from '@/src/utils/platformActions';
import { AnchoredPlatformButton, EditModal } from '@/src/components';

const BOOKMARK_BUTTON = '[data-testid="title-bookmarks-menu-btn"]';

// Copied from the site's secondary button ("Каталог") and its bookmark menu.
const BUTTON_CLASS =
  'cs-button z-0 cursor-pointer group relative inline-flex items-center justify-center box-border appearance-none select-none whitespace-nowrap font-medium subpixel-antialiased transition-all outline-none rounded-full h-9 min-w-9 text-sm bg-secondary text-secondary-foreground hover:bg-secondary/90 !w-full px-6 gap-2';
const MENU_CLASS =
  'border-border bg-popover text-popover-foreground z-50 min-w-[8rem] overflow-auto rounded-md border p-2 shadow-md';
const ITEM_CLASS =
  'focus:bg-accent hover:bg-accent relative my-0.5 flex cursor-pointer items-center rounded-sm px-4 py-1.5 text-sm outline-hidden transition-colors select-none';

/** Title tabs re-create the page; the dropdown opens on load once per title, not on every tab click. */
let lastTitleSlug = '';

export class MangaPage extends BasePage {
  private buttonContainer: HTMLElement | null = null;
  private modalContainer: HTMLElement | null = null;
  private openDropdown = false;
  private slug = '';

  protected async initialize(): Promise<void> {
    await waitForElement(BOOKMARK_BUTTON);

    this.slug = remangaAPI.getSlugFromURL(window.location.href) || '';
    this.openDropdown = this.slug !== lastTitleSlug;

    await useMappingsStore.getState().setContext(this.context.currentPlatform, this.slug);
    useMangaStore.getState().setMangaData(await this.fetchMangaData(this.slug));
  }

  async render(): Promise<void> {
    this.renderPlatformButton();
    // Marked only once shown: a page torn down before rendering must still open it next time.
    lastTitleSlug = this.slug;
    this.renderModal();
    loadAllPlatformsData(
      this.context.currentPlatform,
      Array.from(PlatformRegistry.getOthers(this.context.currentPlatform).keys()),
      this.signal,
      { loggerContext: 'RemangaPage' }
    );
  }

  private async fetchMangaData(slug: string) {
    const [manga, data] = await Promise.all([remangaAPI.getManga(slug), remangaAPI.getMangaData(slug)]);
    const titles = collectTitles(manga);
    return {
      // Some dirs carry a date prefix (`<29.04.2026>naruto_`) that would make the fallback name unsearchable.
      titles: titles.length > 0 ? titles : [slug.replace(/^<[^>]*>/, '').replace(/[-_]+/g, ' ').trim()],
      chapters: null,
      lastChapterRead: data?.lastChapterRead ?? 0,
      freeChapters: 0,
    };
  }

  /** The page has a mobile and a desktop copy of the buttons; only the visible one gets ours. */
  private renderPlatformButton(): void {
    const anchors = [...document.querySelectorAll<HTMLElement>(BOOKMARK_BUTTON)];
    const anchor = anchors.find((el) => el.offsetParent) ?? anchors[0];
    if (!anchor) return;

    this.buttonContainer = document.createElement('div');
    this.buttonContainer.className = 'order-3 w-full';
    anchor.after(this.buttonContainer);

    render(
      <AnchoredPlatformButton
        openOnMount={this.openDropdown}
        onRefresh={(key) => doRefresh(this.context.currentPlatform, key, this.signal, { loggerContext: 'RemangaPage' })}
        menuClass={`remanga-dropdown ${MENU_CLASS}`}
        itemClass={ITEM_CLASS}
        trigger={({ isOpen, toggle, hasNewChapters }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            className={`${BUTTON_CLASS} ${hasNewChapters ? 'ring-2 ring-green-500' : ''}`}
          >
            <PlatformsIcon />
            <span>{t('otherSites')}</span>
          </button>
        )}
      />,
      this.buttonContainer
    );
  }

  private renderModal(): void {
    this.modalContainer = document.createElement('div');
    document.body.appendChild(this.modalContainer);

    render(
      <EditModal
        onSave={(key, url) => doSaveLink(this.context.currentPlatform, key, url, this.signal, { loggerContext: 'RemangaPage' })}
        onDelete={(key) => doDeleteLink(this.context.currentPlatform, key, this.signal, { loggerContext: 'RemangaPage' })}
      />,
      this.modalContainer
    );
  }

  async destroy(): Promise<void> {
    for (const container of [this.buttonContainer, this.modalContainer]) {
      if (!container) continue;
      render(null, container);
      container.remove();
    }
    this.buttonContainer = null;
    this.modalContainer = null;
    useMangaStore.getState().reset();
  }
}

function PlatformsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="size-4 shrink-0">
      <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z" />
    </svg>
  );
}
