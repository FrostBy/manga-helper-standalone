/**
 * ChapterPage for Senkuro
 * Invalidates cache when reading chapters so next visit refreshes data
 */
import { BasePage } from '@/src/pages';
import { Logger } from '@/src/utils/logger';
import { cache } from '@/src/utils/storage';

export class ChapterPage extends BasePage {
  protected async initialize(): Promise<void> {
    // Invalidate cache on load
    await this.invalidateCache();
  }

  async render(): Promise<void> {
    // Listen for SPA navigation
    window.addEventListener('popstate', this.handleNavigation);
  }

  /**
   * Handle SPA navigation
   */
  private handleNavigation = (): void => {
    this.invalidateCache();
  };

  /**
   * Invalidate cache for current manga
   * Deletes cached data so next MangaPage visit fetches fresh data
   */
  private async invalidateCache(): Promise<void> {
    const slug = this.getSlugFromUrl();
    if (!slug) return;

    Logger.debug('SenkuroChapterPage', `Invalidating cache for: ${slug}`);

    // Delete cached data for this manga on senkuro
    await cache.delete('senkuro', slug);
  }

  /**
   * Extract slug from current URL
   * URL pattern: /manga/slug/chapters/123/pages/1
   */
  private getSlugFromUrl(): string {
    const match = window.location.pathname.match(/^\/manga\/([^/]+)\/chapters/);
    return match ? match[1] : '';
  }

  async destroy(): Promise<void> {
    window.removeEventListener('popstate', this.handleNavigation);
  }
}
