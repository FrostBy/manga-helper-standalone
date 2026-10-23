/**
 * MangaPage for Manga-chan — "Other sites" is one more of the site's action rows
 * (`div.user_link` with an `a.fav_plus` link) under "add to collection".
 */
import { render } from 'preact';
import { BasePage } from '@/src/pages';
import { waitForElement, t } from '@/src/utils';
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { mangachanAPI } from '@/src/api';
import { collectTitles } from '@/src/utils/manga';
import {
  loadAllPlatformsData,
  handleRefresh as doRefresh,
  handleSaveLink as doSaveLink,
  handleDeleteLink as doDeleteLink,
} from '@/src/utils/platformActions';
import { AnchoredPlatformButton, EditModal } from '@/src/components';

const LAST_ACTION = 'div.user_link[id^="ratig-layer-fav"]';

export class MangaPage extends BasePage {
  private buttonContainer: HTMLElement | null = null;
  private modalContainer: HTMLElement | null = null;

  protected async initialize(): Promise<void> {
    await waitForElement(LAST_ACTION);
    const slug = mangachanAPI.getSlugFromURL(window.location.href) || '';
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
      { loggerContext: 'MangaChanPage' }
    );
  }

  private async fetchMangaData(slug: string) {
    const [manga, data] = await Promise.all([mangachanAPI.getManga(slug), mangachanAPI.getMangaData(slug)]);
    const titles = collectTitles(manga);
    return {
      titles: titles.length > 0 ? titles : [slug.replace(/^\d+-/, '').replace(/-/g, ' ')],
      chapters: null,
      lastChapterRead: data?.lastChapterRead ?? 0,
      freeChapters: 0,
    };
  }

  private renderPlatformButton(): void {
    const anchor = document.querySelector(LAST_ACTION);
    if (!anchor) return;

    this.buttonContainer = document.createElement('div');
    this.buttonContainer.className = 'user_link';
    anchor.after(this.buttonContainer);

    render(
      <AnchoredPlatformButton
        openOnMount
        onRefresh={(key) => doRefresh(this.context.currentPlatform, key, this.signal, { loggerContext: 'MangaChanPage' })}
        menuClass="mangachan-dropdown"
        trigger={({ isOpen, toggle, hasNewChapters }) => (
          <a
            href="#"
            role="button"
            aria-expanded={isOpen}
            class={`fav_plus ${hasNewChapters ? 'mangachan-has-new' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              toggle();
            }}
          >
            <PlatformsIcon /> {t('otherSites')}
          </a>
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
        onSave={(key, url) => doSaveLink(this.context.currentPlatform, key, url, this.signal, { loggerContext: 'MangaChanPage' })}
        onDelete={(key) => doDeleteLink(this.context.currentPlatform, key, this.signal, { loggerContext: 'MangaChanPage' })}
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

/** Sized like the site's 16px action icons. */
function PlatformsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="16" height="16" style={{ verticalAlign: 'text-bottom' }}>
      <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z" />
    </svg>
  );
}
