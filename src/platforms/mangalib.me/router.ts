import { BaseRouter } from '@/src/router';
import type { RoutesConfig } from '@/src/router';
import type { PlatformKey } from '@/src/types';
import { tokens } from '@/src/utils/storage';
import { resolveActiveDomain } from '@/src/utils/mirrors';
import { config } from './config';
import { MANGALIB_MIRROR_CONFIGS } from '@/src/api/mangalib';
import { MangaPage, ChapterPage } from './pages';

export class MangaLibRouter extends BaseRouter {
  readonly platformKey: PlatformKey = 'mangalib';
  readonly routes: RoutesConfig = {
    manga: {
      // /ru/manga/123--slug or /manga/123--slug
      path: (pathname) => /^(\/ru)?\/manga\/\d+--[^/]+$/.test(pathname),
      page: MangaPage,
    },
    chapter: {
      // /ru/manga/123--slug/read/v1/c1
      path: (pathname) => /\/read\//.test(pathname),
      page: ChapterPage,
    },
  };

  protected async preInit(): Promise<void> {
    // Add body class for scoped styles
    document.body.classList.add('mangalib');

    // Extract and save auth token from localStorage
    const activeDomain = resolveActiveDomain(config);
    const tokenKey = MANGALIB_MIRROR_CONFIGS[activeDomain]?.tokenKey ?? 'mangalib';
    try {
      const auth = JSON.parse(localStorage.getItem('auth') || '{}');
      const token = auth?.token?.access_token;
      if (token) {
        await tokens.set(tokenKey, token);
      }
    } catch {
      // Ignore parse errors
    }
  }
}
