/**
 * ChapterPage for Inkstory
 * Saves the reading position for logged-out users — the site keeps no
 * bookmark for them that the API could read back.
 */
import { BasePage } from '@/src/pages';
import { inkstoryAPI } from '@/src/api';
import { userProgress } from '@/src/utils/storage';

export class ChapterPage extends BasePage {
  protected async initialize(): Promise<void> {
    // The route guarantees /content/{slug}/{chapterId}.
    const [, , slug, chapterId] = window.location.pathname.split('/');
    const position = await inkstoryAPI.getChapterPosition(slug, chapterId);
    if (position && !this.signal.aborted) await userProgress.set('inkstory', slug, position);
  }

  async render(): Promise<void> {}
  async destroy(): Promise<void> {}
}
