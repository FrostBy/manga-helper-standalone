/**
 * MangaPage for com-x.life
 *
 * Title page renders chapters through a Vue widget fed by a `window.__DATA__`
 * inline script. We read that same payload from the document instead of
 * scraping the rendered list, so numbering stays consistent with the API path.
 */
import { render } from 'preact';
import { BasePage } from '@/src/pages';
import { waitForElement, t } from '@/src/utils';
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { comxAPI } from '@/src/api';
import { Logger } from '@/src/utils/logger';
import {
  loadAllPlatformsData,
  handleRefresh as doRefresh,
  handleSaveLink as doSaveLink,
  handleDeleteLink as doDeleteLink,
} from '@/src/utils/platformActions';
import { EditModal } from '@/src/components';
import { ComXPlatformButton } from '../ComXPlatformButton';

export class MangaPage extends BasePage {
  private buttonContainer: HTMLElement | null = null;
  private modalContainer: HTMLElement | null = null;
  private statsContainer: HTMLElement | null = null;
  private chaptersTabTitle: HTMLElement | null = null;
  private unsubscribeStore: (() => void) | null = null;

  protected async initialize(): Promise<void> {
    await waitForElement('.comix__fullstory');

    const slug = this.getSlugFromUrl();
    await useMappingsStore.getState().setContext(this.context.currentPlatform, slug);

    const data = await this.fetchMangaData(slug);
    Logger.debug('ComX', 'fetchMangaData result', data);
    useMangaStore.getState().setMangaData(data);
  }

  async render(): Promise<void> {
    await this.findChaptersTabTitle();
    this.renderStats();
    await this.renderPlatformButton();
    this.renderModal();

    loadAllPlatformsData(
      this.context.currentPlatform,
      Array.from(PlatformRegistry.getOthers(this.context.currentPlatform).keys()),
      this.signal,
      { loggerContext: 'ComXPage' }
    );

    this.subscribeToStoreChanges();
  }

  /**
   * Read chapters + progress straight from the page's own `__DATA__` — it is
   * already in the document, so no refetch and no anti-bot risk here.
   */
  private async fetchMangaData(slug: string) {
    const html = document.documentElement.outerHTML;
    const manga = comxAPI.parseMangaHTML(html);
    const data = await comxAPI.getData(slug);

    const titles: string[] = [];
    if (manga?.name) titles.push(manga.name);
    if (manga?.otherNames) titles.push(...manga.otherNames);

    return {
      titles: titles.length > 0 ? titles : [slug.replace(/^\d+-/, '').replace(/-/g, ' ')],
      chapters: null,
      lastChapterRead: data?.lastChapterRead ?? 0,
      freeChapters: data?.chapter ?? 0,
    };
  }

  /**
   * The site's own tab already prints the total ("Главы (116)"), so only the
   * read position is appended — same approach as ReadManga and Inkstory.
   */
  private renderStats(): void {
    if (!this.chaptersTabTitle) return;

    // Rendered even at zero: "[0]" is the answer to "how far am I", an absent
    // badge just looks like the extension failed to load.
    const { lastChapterRead } = useMangaStore.getState();

    if (!this.statsContainer) {
      this.statsContainer = document.createElement('span');
      this.statsContainer.className = 'chapters-all';
      this.chaptersTabTitle.appendChild(this.statsContainer);
    }

    render(<> [{lastChapterRead}]</>, this.statsContainer);
  }

  /** Tabs are static SSR markup here, so the title node is safe to hold on to. */
  private async findChaptersTabTitle(): Promise<void> {
    await waitForElement('.tabs__select');

    for (const item of document.querySelectorAll('.tabs__select-item')) {
      if (item.textContent?.includes('Главы')) {
        this.chaptersTabTitle = item.querySelector('.tabs__select-title');
        return;
      }
    }
  }

  /** Sits right above the site's "Push-уведомления" button in .page__btns. */
  private async renderPlatformButton(): Promise<void> {
    const pushButton = await waitForElement('.page__btns .push-subscribe-btn');
    if (!pushButton) return;

    this.buttonContainer = document.createElement('div');
    this.buttonContainer.style.display = 'contents';
    pushButton.before(this.buttonContainer);

    render(
      <ComXPlatformButton
        onRefresh={(key) => doRefresh(this.context.currentPlatform, key, this.signal, { loggerContext: 'ComXPage' })}
      />,
      this.buttonContainer
    );
  }

  private renderModal(): void {
    this.modalContainer = document.createElement('div');
    document.body.appendChild(this.modalContainer);

    render(
      <EditModal
        onSave={(key, url) => doSaveLink(this.context.currentPlatform, key, url, this.signal, { loggerContext: 'ComXPage' })}
        onDelete={(key) => doDeleteLink(this.context.currentPlatform, key, this.signal, { loggerContext: 'ComXPage' })}
      />,
      this.modalContainer
    );
  }

  private subscribeToStoreChanges(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = useMangaStore.subscribe((state, prevState) => {
      if (
        state.freeChapters !== prevState.freeChapters ||
        state.lastChapterRead !== prevState.lastChapterRead
      ) {
        this.renderStats();
      }
    });
  }

  private getSlugFromUrl(): string {
    return comxAPI.getSlugFromURL(window.location.href) || '';
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

    if (this.statsContainer) {
      render(null, this.statsContainer);
      if (this.statsContainer.isConnected) {
        this.statsContainer.remove();
      }
      this.statsContainer = null;
    }
    this.chaptersTabTitle = null;

    useMangaStore.getState().reset();
    useMappingsStore.getState().reset();
  }
}
