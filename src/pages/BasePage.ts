/**
 * Base class for all pages
 * Provides lifecycle management: initialize → render → destroy
 */
import type { PageContext } from './types';

export abstract class BasePage {
  /**
   * Context with dependencies (platforms, abort controller, etc.)
   */
  protected context!: PageContext;

  /**
   * Initialize page data (fetch API, prepare state)
   * Called once before render
   */
  protected abstract initialize(): Promise<void>;

  /**
   * Render page UI
   * Called after initialize
   */
  abstract render(): Promise<void>;

  /**
   * Cleanup when navigating away
   * Remove event listeners, DOM elements, etc.
   */
  abstract destroy(): Promise<void>;

  /**
   * Shortcut to abort signal for async operations
   */
  protected get signal(): AbortSignal {
    return this.context.abortController.signal;
  }

  /**
   * Factory method to create and initialize page instance
   */
  static async createInstance<T extends BasePage>(
    this: new () => T,
    context: PageContext
  ): Promise<T> {
    const instance = new this();
    instance.context = context;
    await instance.initialize();
    return instance;
  }
}
