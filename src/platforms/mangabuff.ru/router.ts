import { BaseRouter } from '@/src/router';
import type { RoutesConfig } from '@/src/router';
import type { PlatformKey } from '@/src/types';
import { userProgress } from '@/src/utils/storage';
import { MangaPage, ChapterPage } from './pages';

export class MangaBuffRouter extends BaseRouter {
  readonly platformKey: PlatformKey = 'mangabuff';
  readonly routes: RoutesConfig = {
    manga: {
      // /manga/slug
      path: (pathname) => /^\/manga\/[^/]+$/.test(pathname),
      page: MangaPage,
    },
    chapter: {
      // /manga/slug/vol/ch (e.g., /manga/one-piece/1/1)
      path: (pathname) => /^\/manga\/[^/]+\/\d+\/\d+$/.test(pathname),
      page: ChapterPage,
    },
  };

  protected async preInit(): Promise<void> {
    document.body.classList.add('mangabuff');

    // Extract reading progress from MangaBuff's localStorage
    const slug = this.getSlugFromUrl();
    if (!slug) return;

    try {
      const historyData = localStorage.getItem('history');
      if (!historyData) return;

      const history = JSON.parse(historyData) as Array<{ slug: string; chapter: number }>;
      const existingVisit = history.find((visit) => visit.slug === slug);

      if (existingVisit?.chapter) {
        await userProgress.set(this.platformKey, slug, +existingVisit.chapter);
      }
    } catch {
      // Ignore localStorage parse errors
    }
  }

  private getSlugFromUrl(): string {
    const match = window.location.pathname.match(/^\/manga\/([^/]+)/);
    return match?.[1] ?? '';
  }
}
