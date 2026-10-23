import type { PlatformKey } from '@/src/types';
import { ReadMangaRouter } from '@/src/platforms/readmanga.io/router';

/** ReadManga's engine and pages; the own key keeps AllHentai's token and cache apart from ReadManga's. */
export class AllHentaiRouter extends ReadMangaRouter {
  readonly platformKey: PlatformKey = 'allhentai';
}
