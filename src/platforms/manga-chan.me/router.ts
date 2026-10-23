import { BaseRouter } from '@/src/router';
import type { RoutesConfig } from '@/src/router';
import type { PlatformKey } from '@/src/types';
import { MangaPage, ChapterPage } from './pages';

export class MangaChanRouter extends BaseRouter {
  readonly platformKey: PlatformKey = 'mangachan';
  readonly routes: RoutesConfig = {
    manga: {
      path: (pathname) => /^\/manga\/\d+-[^/]+\.html$/.test(pathname),
      page: MangaPage,
    },
    chapter: {
      path: (pathname) => /^\/online\/\d+-[^/]+\.html$/.test(pathname),
      page: ChapterPage,
    },
  };
}
