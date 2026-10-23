/**
 * MangaPage for Mangahub — Bootstrap 5, so the shared Bootstrap button and dropdown;
 * the site has no Font Awesome, hence SVG icons.
 */
import { render } from 'preact';
import { BasePage } from '@/src/pages';
import { waitForElement, t } from '@/src/utils';
import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { mangahubAPI } from '@/src/api';
import { namesFromTitlePage } from '@/src/api/mangahub';
import {
  loadAllPlatformsData,
  handleRefresh as doRefresh,
  handleSaveLink as doSaveLink,
  handleDeleteLink as doDeleteLink,
} from '@/src/utils/platformActions';
import { BootstrapPlatformButton, EditModal } from '@/src/components';

const START_BUTTON = 'a.btn-primary[href^="/read/"]';

export class MangaPage extends BasePage {
  private buttonContainer: HTMLElement | null = null;
  private modalContainer: HTMLElement | null = null;

  protected async initialize(): Promise<void> {
    await waitForElement(START_BUTTON);
    const slug = mangahubAPI.getSlugFromURL(window.location.href) || '';
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
      { loggerContext: 'MangaHubPage' }
    );
  }

  private async fetchMangaData(slug: string) {
    const titles = namesFromTitlePage(document);
    const data = await mangahubAPI.getMangaData(slug);
    return {
      titles: titles.length > 0 ? titles : [slug.replace(/_/g, ' ')],
      chapters: null,
      lastChapterRead: data?.lastChapterRead ?? 0,
      freeChapters: 0,
    };
  }

  /** The title card exists twice (mobile and desktop); only the visible one gets the button. */
  private renderPlatformButton(): void {
    const starts = [...document.querySelectorAll<HTMLElement>(START_BUTTON)];
    const anchor = (starts.find((el) => el.offsetParent) ?? starts[0])?.parentElement;
    if (!anchor) return;

    this.buttonContainer = document.createElement('div');
    this.buttonContainer.className = 'mb-2';
    anchor.after(this.buttonContainer);

    render(
      <BootstrapPlatformButton
        className="btn btn-lg btn-primary w-100"
        svgIcons
        onRefresh={(key) => doRefresh(this.context.currentPlatform, key, this.signal, { loggerContext: 'MangaHubPage' })}
      >
        {t('otherSites')}
      </BootstrapPlatformButton>,
      this.buttonContainer
    );
  }

  private renderModal(): void {
    this.modalContainer = document.createElement('div');
    document.body.appendChild(this.modalContainer);

    render(
      <EditModal
        onSave={(key, url) => doSaveLink(this.context.currentPlatform, key, url, this.signal, { loggerContext: 'MangaHubPage' })}
        onDelete={(key) => doDeleteLink(this.context.currentPlatform, key, this.signal, { loggerContext: 'MangaHubPage' })}
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
