import { BaseRouter } from '@/src/router';
import type { RoutesConfig } from '@/src/router';
import type { PlatformKey } from '@/src/types';
import { MangaPage, ChapterPage } from './pages';

export class ComXRouter extends BaseRouter {
  readonly platformKey: PlatformKey = 'comx';
  readonly routes: RoutesConfig = {
    manga: {
      // /{news_id}-{slug}.html — title page
      path: (pathname) => /^\/\d+-[^/]+\.html$/.test(pathname),
      page: MangaPage,
    },
    chapter: {
      // /reader/{news_id}/{chapter_id}
      path: (pathname) => /^\/reader\/\d+\/\d+/.test(pathname),
      page: ChapterPage,
    },
  };

  protected async preInit(): Promise<void> {
    document.body.classList.add('comx');
  }
}
