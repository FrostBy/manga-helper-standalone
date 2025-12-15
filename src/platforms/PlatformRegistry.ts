/**
 * Central registry for platform APIs
 * Platforms self-register on import
 */
import type { BasePlatformAPI } from '@/src/api/base';
import type { PlatformKey } from '@/src/types';
import { Logger } from '@/src/utils/logger';

class PlatformRegistryClass {
  private platforms = new Map<PlatformKey, BasePlatformAPI>();

  /**
   * Register a platform API
   */
  register(api: BasePlatformAPI): void {
    const { key } = api.config;

    if (this.platforms.has(key)) {
      Logger.warn('PlatformRegistry', `Platform "${key}" already registered, overwriting`);
    }

    this.platforms.set(key, api);
    Logger.debug('PlatformRegistry', `Registered: ${key} (${api.config.domain})`);
  }

  /**
   * Get platform API by key
   */
  get(key: PlatformKey): BasePlatformAPI | undefined {
    return this.platforms.get(key);
  }

  /**
   * Get all registered platform APIs
   */
  getAll(): Map<PlatformKey, BasePlatformAPI> {
    return new Map(this.platforms);
  }

  /**
   * Get all platform keys
   */
  getKeys(): PlatformKey[] {
    return Array.from(this.platforms.keys());
  }

  /**
   * Get all platforms except the specified one
   */
  getOthers(excludeKey: PlatformKey): Map<PlatformKey, BasePlatformAPI> {
    const result = new Map<PlatformKey, BasePlatformAPI>();
    for (const [key, api] of this.platforms) {
      if (key !== excludeKey) {
        result.set(key, api);
      }
    }
    return result;
  }

  /**
   * Check if platform is registered
   */
  has(key: PlatformKey): boolean {
    return this.platforms.has(key);
  }
}

// Singleton instance
export const PlatformRegistry = new PlatformRegistryClass();
