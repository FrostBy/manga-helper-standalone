import { BaseRouter } from '@/src/router';
import type { RoutesConfig } from '@/src/router';
import type { PlatformKey } from '@/src/types';
import { tokens, userProgress } from '@/src/utils/storage';
import { MangaPage, ChapterPage } from './pages';

declare global {
  interface Window {
    __inkstoryAstroState?: unknown[];
  }
}

export class InkstoryRouter extends BaseRouter {
  readonly platformKey: PlatformKey = 'inkstory';
  readonly routes: RoutesConfig = {
    manga: {
      // /content/slug (without page= query param)
      path: (pathname, query) =>
        /^\/content\//.test(pathname) && !('page' in query),
      page: MangaPage,
    },
    chapter: {
      // /content/slug?...page=N
      path: (pathname, query) =>
        /^\/content\//.test(pathname) && 'page' in query,
      page: ChapterPage,
    },
  };

  private lastSavedChapterId: string = '';

  protected async preInit(): Promise<void> {
    document.body.classList.add('inkstory');

    // Save auth token from captured astro state
    await this.saveToken();

    // Save progress when on chapter reading page
    // Called on every navigation via BaseRouter's locationchange detection
    await this.saveProgressIfNeeded();
  }

  private async saveProgressIfNeeded(): Promise<void> {
    const { slug, chapterId } = this.parseUrl();

    // Only save if on chapter page and chapter changed
    if (slug && chapterId && chapterId !== this.lastSavedChapterId) {
      const chapterNumber = await this.fetchChapterNumber(chapterId);
      if (chapterNumber) {
        await userProgress.set(this.platformKey, slug, chapterNumber);
        this.lastSavedChapterId = chapterId;
      }
    }
  }

  private async saveToken(): Promise<void> {
    try {
      // Read from captured astro state (captured in entrypoint before script was removed)
      const data = window.__inkstoryAstroState;
      if (!data || !Array.isArray(data)) return;

      // Find object with accessToken property (devalue format)
      for (const item of data) {
        if (item && typeof item === 'object' && !Array.isArray(item) && 'accessToken' in item) {
          const tokenIndex = (item as Record<string, unknown>).accessToken;
          if (typeof tokenIndex === 'number' && typeof data[tokenIndex] === 'string') {
            await tokens.set(this.platformKey, data[tokenIndex] as string);
            return;
          }
          break;
        }
      }
    } catch {
      // Ignore errors
    }
  }

  private parseUrl(): { slug: string; chapterId: string } {
    // /content/slug/chapterId?page=N
    const match = window.location.pathname.match(/^\/content\/([^/]+)\/([^/?#]+)/);
    return {
      slug: match?.[1] ?? '',
      chapterId: match?.[2] ?? '',
    };
  }

  private async fetchChapterNumber(chapterId: string): Promise<number> {
    try {
      const response = await fetch(`https://api.inkstory.net/v2/chapters/${chapterId}`, {
        credentials: 'include',
      });
      if (!response.ok) return 0;

      const data = await response.json();
      return data?.number || 0;
    } catch {
      return 0;
    }
  }

  async destroy(): Promise<void> {
    await super.destroy();
  }
}
