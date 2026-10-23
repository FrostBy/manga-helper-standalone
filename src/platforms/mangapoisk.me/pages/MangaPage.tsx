/**
 * MangaPage for MangaPoisk — Skeleton UI on Tailwind: the button and menu wear
 * the site's own classes, its theme colours live only there.
 */
import { render } from 'preact';
import { BasePage } from '@/src/pages';
import { waitForElement, t } from '@/src/utils';
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { mangapoiskAPI } from '@/src/api';
import { collectTitles } from '@/src/utils/manga';
import {
  loadAllPlatformsData,
  handleRefresh as doRefresh,
  handleSaveLink as doSaveLink,
  handleDeleteLink as doDeleteLink,
} from '@/src/utils/platformActions';
import { AnchoredPlatformButton, EditModal } from '@/src/components';

const READ_BUTTON = 'a.btn.variant-filled-primary';

// Copied from the site's "add to bookmarks" button and its user menu.
const BUTTON_CLASS = 'btn btn-sm max-sm:px-1 variant-filled-secondary whitespace-normal';
const MENU_CLASS = 'mangapoisk-dropdown card shadow-xl text-base py-2';
const ITEM_CLASS = 'flex items-center px-4 py-2 text-sm hover:bg-surface-100 hover:text-surface-900';

export class MangaPage extends BasePage {
  private buttonContainer: HTMLElement | null = null;
  private modalContainer: HTMLElement | null = null;

  protected async initialize(): Promise<void> {
    await waitForElement(READ_BUTTON);
    const slug = mangapoiskAPI.getSlugFromURL(window.location.href) || '';
    await useMappingsStore.getState().setContext(this.context.currentPlatform, slug);
    useMangaStore.getState().setMangaData(await this.fetchMangaData(slug));
  }

  async render(): Promise<void> {
    this.renderPlatformButton();
    this.renderModal();
    loadAllPlatformsData(
      this.context.currentPlatform,
      Array.from(PlatformRegistry.getOthers(this.context.currentPlatform).keys()),
      this.signal,
      { loggerContext: 'MangaPoiskPage' }
    );
  }

  private async fetchMangaData(slug: string) {
    const [manga, data] = await Promise.all([mangapoiskAPI.getManga(slug), mangapoiskAPI.getMangaData(slug)]);
    const titles = collectTitles(manga);
    return {
      titles: titles.length > 0 ? titles : [slug.replace(/-/g, ' ')],
      chapters: null,
      lastChapterRead: data?.lastChapterRead ?? 0,
      freeChapters: 0,
    };
  }

  private renderPlatformButton(): void {
    const row = document.querySelector(READ_BUTTON)?.parentElement;
    if (!row) return;

    this.buttonContainer = document.createElement('div');
    row.appendChild(this.buttonContainer);

    render(
      <AnchoredPlatformButton
        openOnMount
        onRefresh={(key) => doRefresh(this.context.currentPlatform, key, this.signal, { loggerContext: 'MangaPoiskPage' })}
        menuClass={MENU_CLASS}
        itemClass={ITEM_CLASS}
        trigger={({ isOpen, toggle, hasNewChapters }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            class={`${BUTTON_CLASS} ${hasNewChapters ? 'ring-2 ring-green-500' : ''}`}
          >
            {t('otherSites')}
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
        onSave={(key, url) => doSaveLink(this.context.currentPlatform, key, url, this.signal, { loggerContext: 'MangaPoiskPage' })}
        onDelete={(key) => doDeleteLink(this.context.currentPlatform, key, this.signal, { loggerContext: 'MangaPoiskPage' })}
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
