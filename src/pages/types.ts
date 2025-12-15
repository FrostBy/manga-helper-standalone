/**
 * Page types and context for dependency injection
 */
import type { PlatformKey } from '@/src/types';
import type { BasePlatformAPI } from '@/src/api/base';

/**
 * Platform access interface for pages
 */
export interface PlatformAccess {
  /**
   * Get platform API by key
   */
  get(key: PlatformKey): BasePlatformAPI | undefined;

  /**
   * Get all platform keys
   */
  getKeys(): PlatformKey[];

  /**
   * Get all platforms except the specified one
   */
  getOthers(excludeKey: PlatformKey): Map<PlatformKey, BasePlatformAPI>;
}

/**
 * Context passed to pages via dependency injection
 */
export interface PageContext {
  /**
   * Access to all registered platforms
   */
  platforms: PlatformAccess;

  /**
   * Current platform key (the platform we're on)
   */
  currentPlatform: PlatformKey;

  /**
   * Abort controller for cancelling async operations on navigation
   */
  abortController: AbortController;
}
