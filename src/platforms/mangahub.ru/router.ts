import { BaseRouter } from '@/src/router';
import type { RoutesConfig } from '@/src/router';
import type { PlatformKey } from '@/src/types';
import { MangaPage, ChapterPage } from './pages';

export class MangaHubRouter extends BaseRouter {
  readonly platformKey: PlatformKey = 'mangahub';
  readonly routes: RoutesConfig = {
    manga: {
      path: (pathname) => /^\/title\/[^/]+\/?$/.test(pathname),
      page: MangaPage,
    },
    chapter: {
      path: (pathname) => /^\/read\/\d+\/?$/.test(pathname),
      page: ChapterPage,
    },
  };
}
