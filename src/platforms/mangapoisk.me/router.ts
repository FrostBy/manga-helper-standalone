import { BaseRouter } from '@/src/router';
import type { RoutesConfig } from '@/src/router';
import type { PlatformKey } from '@/src/types';
import { MangaPage, ChapterPage } from './pages';

export class MangaPoiskRouter extends BaseRouter {
  readonly platformKey: PlatformKey = 'mangapoisk';
  readonly routes: RoutesConfig = {
    manga: {
      path: (pathname) => /^\/manga\/[^/]+\/?$/.test(pathname),
      page: MangaPage,
    },
    chapter: {
      path: (pathname) => /^\/manga\/[^/]+\/chapter\/[^/]+\/?$/.test(pathname),
      page: ChapterPage,
    },
  };
}
