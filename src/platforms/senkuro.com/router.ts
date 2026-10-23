import { BaseRouter } from '@/src/router';
import type { RoutesConfig } from '@/src/router';
import type { PlatformKey } from '@/src/types';
import { tokens } from '@/src/utils/storage';
import { senkuroAPI } from '@/src/api';
import { MangaPage, ChapterPage } from './pages';

export class SenkuroRouter extends BaseRouter {
  readonly platformKey: PlatformKey = 'senkuro';
  readonly routes: RoutesConfig = {
    manga: {
      // /manga/slug or /manga/slug/translations or /manga/slug/chapters (with optional trailing slash)
      path: (pathname) => /^\/manga\/[^/]+(\/[a-zA-Z0-9-]*)?\/?$/.test(pathname),
      page: MangaPage,
    },
    chapter: {
      // /manga/slug/chapters/123/pages/1
      path: (pathname) => /chapters\/\d+\/pages\/\d+/.test(pathname),
      page: ChapterPage,
    },
  };

  protected async preInit(): Promise<void> {
    document.body.classList.add('senkuro');

    // One key for senkuro and senkognito: a token from either works on every API host.
    const token = this.getCookie('access_token');
    if (token) {
      await tokens.set(this.platformKey, token);
    }
    await senkuroAPI.claimPage(window.location.href);
  }

  private getCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
  }
}
