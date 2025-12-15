import { BaseRouter } from '@/src/router';
import type { RoutesConfig } from '@/src/router';
import type { PlatformKey } from '@/src/types';
import { tokens } from '@/src/utils/storage';
import { MangaPage, ChapterPage } from './pages';

export class ReadMangaRouter extends BaseRouter {
  readonly platformKey: PlatformKey = 'readmanga';
  readonly routes: RoutesConfig = {
    manga: {
      // /slug (manga page with h1.names element)
      path: (pathname) => /^\/[^/]+$/.test(pathname) && pathname !== '/',
      page: MangaPage,
    },
    chapter: {
      // /slug/vol/ch (chapter page with .page-reader class)
      path: (pathname) => /^\/[^/]+\/vol\d+\/\d+/.test(pathname),
      page: ChapterPage,
    },
  };

  protected async preInit(): Promise<void> {
    document.body.classList.add('readmanga');

    // Get auth token from localStorage
    try {
      const tokenData = localStorage.getItem('gwt');
      if (tokenData) {
        const token = JSON.parse(tokenData);
        if (token) {
          await tokens.set(this.platformKey, token);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }
}
