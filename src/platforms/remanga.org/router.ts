import { BaseRouter } from '@/src/router';
import type { RoutesConfig } from '@/src/router';
import type { PlatformKey } from '@/src/types';
import { tokens } from '@/src/utils/storage';
import { MangaPage, ChapterPage } from './pages';

const TOKEN_COOKIE = 'auth:token=';

export class RemangaRouter extends BaseRouter {
  readonly platformKey: PlatformKey = 'remanga';
  readonly routes: RoutesConfig = {
    // /manga/{dir} and its tabs (/main, /chapters…); a numeric segment is the reader.
    manga: {
      path: (pathname) => /^\/manga\/[^/]+(\/[a-z-]+)?\/?$/.test(pathname),
      page: MangaPage,
    },
    chapter: {
      path: (pathname) => /^\/manga\/[^/]+\/\d+\/?$/.test(pathname),
      page: ChapterPage,
    },
  };

  /**
   * The cookie is JSON-quoted. Signed out it is absent — a token kept from
   * before would make every authorized request fail instead of counting 0.
   */
  protected async preInit(): Promise<void> {
    const raw = document.cookie.split('; ').find((c) => c.startsWith(TOKEN_COOKIE))?.slice(TOKEN_COOKIE.length);
    if (!raw) {
      await tokens.delete(this.platformKey);
      return;
    }
    let token = raw;
    try {
      token = decodeURIComponent(raw);
      token = JSON.parse(token);
    } catch {
      // Not encoded or not quoted: what decoded so far is the token.
    }
    if (token) await tokens.set(this.platformKey, token);
  }
}
