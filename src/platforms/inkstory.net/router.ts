import { BaseRouter } from '@/src/router';
import type { RoutesConfig } from '@/src/router';
import type { PlatformKey } from '@/src/types';
import { inkstoryAPI } from '@/src/api';
import { MangaPage, ChapterPage } from './pages';

export class InkstoryRouter extends BaseRouter {
  readonly platformKey: PlatformKey = 'inkstory';
  readonly routes: RoutesConfig = {
    // Tabs listed explicitly: /content/{slug}/upload has no title layout.
    manga: {
      path: (pathname) =>
        /^\/content\/[^/]+(\/(chapters|comments|reviews|discussions|media))?\/?$/.test(pathname),
      page: MangaPage,
    },
    // /content/{slug}/{chapterId}
    chapter: {
      path: (pathname) => /^\/content\/[^/]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/.test(pathname),
      page: ChapterPage,
    },
  };

  protected async preInit(): Promise<void> {
    document.body.classList.add('inkstory');
    await inkstoryAPI.claimPage(window.location.href);
  }
}
