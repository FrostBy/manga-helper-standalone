/**
 * Chrome/Firefox/Safari storage wrapper with type safety
 *
 * Structure:
 * - sync:manual → platform/slug/targetPlatform → targetSlug (user-defined, synced)
 * - local:auto → platform/slug/targetPlatform → targetSlug|false (auto-discovered, with TTL)
 * - local:cache → targetPlatform/targetSlug → { chapter, lastChapterRead, expires }
 *
 * Concurrent writes within the same tab are serialized via per-key write locks
 * to prevent read-modify-write race conditions (e.g., parallel platform searches).
 * Cross-tab writes are still non-atomic — rare in practice since users use one tab.
 */
import { storage } from '@wxt-dev/storage';
import { Logger } from './logger';
import type {
  AllMappings,
  AllAutoMappings,
  AllCache,
  CachedPlatformData,
  PlatformMapping,
  AutoPlatformMapping,
  MappingValue,
  PlatformKey,
} from '@/src/types';

// Storage keys
const KEYS = {
  MANUAL_MAPPINGS: 'sync:manual',
  AUTO_MAPPINGS: 'local:auto',
  CACHE: 'local:cache',
  SETTINGS: 'sync:settings',
  TOKENS: 'local:tokens',
} as const;

// Default TTL: 1 hour
const DEFAULT_TTL = 60 * 60 * 1000;

/**
 * Per-key write lock to serialize read-modify-write storage operations.
 * Prevents concurrent writes from overwriting each other.
 */
function createLock() {
  let chain: Promise<void> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const result = chain.catch(() => {}).then(fn);
    chain = result.then(() => {}, () => {});
    return result;
  };
}

const autoLock = createLock();
const cacheLock = createLock();

/**
 * Manual mappings (user-defined, synced across devices)
 * No TTL - permanent until deleted
 */
export const manualMappings = {
  async getAll(): Promise<AllMappings> {
    return (await storage.getItem<AllMappings>(KEYS.MANUAL_MAPPINGS)) ?? {};
  },

  async get(
    platform: string,
    slug: string,
    targetPlatform: string
  ): Promise<string | null> {
    const all = await this.getAll();
    const value = all[platform]?.[slug]?.[targetPlatform];
    // Manual mappings only store strings, never false
    return typeof value === 'string' ? value : null;
  },

  async set(
    platform: string,
    slug: string,
    targetPlatform: string,
    targetSlug: string
  ): Promise<void> {
    try {
      const all = await this.getAll();

      if (!all[platform]) all[platform] = {};
      if (!all[platform][slug]) all[platform][slug] = {};
      all[platform][slug][targetPlatform] = targetSlug;

      await storage.setItem(KEYS.MANUAL_MAPPINGS, all);
    } catch (error) {
      Logger.error('Storage', 'Failed to save manual mapping', error);
      throw error;
    }
  },

  async delete(
    platform: string,
    slug: string,
    targetPlatform: string
  ): Promise<void> {
    const all = await this.getAll();

    if (all[platform]?.[slug]?.[targetPlatform] !== undefined) {
      delete all[platform][slug][targetPlatform];

      // Clean up empty objects
      if (Object.keys(all[platform][slug]).length === 0) {
        delete all[platform][slug];
      }
      if (Object.keys(all[platform]).length === 0) {
        delete all[platform];
      }

      await storage.setItem(KEYS.MANUAL_MAPPINGS, all);
    }
  },

  async getAllForSlug(
    platform: string,
    slug: string
  ): Promise<PlatformMapping> {
    const all = await this.getAll();
    return all[platform]?.[slug] ?? {};
  },
};

/**
 * Auto-discovered mappings (local only, with TTL)
 * Can store false if search found nothing (prevents API spam)
 */
export const autoMappings = {
  async getAll(): Promise<AllAutoMappings> {
    return (await storage.getItem<AllAutoMappings>(KEYS.AUTO_MAPPINGS)) ?? {};
  },

  async get(
    platform: string,
    slug: string,
    targetPlatform: string
  ): Promise<MappingValue | null> {
    const all = await this.getAll();
    const entry = all[platform]?.[slug]?.[targetPlatform];

    if (!entry) return null;

    // Check TTL - lazy deletion (don't delete here, just return null)
    // Actual deletion happens in flushExpired() called periodically
    if (Date.now() > entry.expires) {
      return null;
    }

    return entry.value;
  },

  set(
    platform: string,
    slug: string,
    targetPlatform: string,
    targetSlug: MappingValue,
    ttl: number = DEFAULT_TTL
  ): Promise<void> {
    return autoLock(async () => {
      try {
        const all = await this.getAll();

        if (!all[platform]) all[platform] = {};
        if (!all[platform][slug]) all[platform][slug] = {};
        all[platform][slug][targetPlatform] = {
          value: targetSlug,
          expires: Date.now() + ttl,
        };

        await storage.setItem(KEYS.AUTO_MAPPINGS, all);
      } catch (error) {
        Logger.error('Storage', 'Failed to save auto mapping', error);
        throw error;
      }
    });
  },

  delete(
    platform: string,
    slug: string,
    targetPlatform: string
  ): Promise<void> {
    return autoLock(async () => {
      const all = await this.getAll();

      if (all[platform]?.[slug]?.[targetPlatform] !== undefined) {
        delete all[platform][slug][targetPlatform];

        // Clean up empty objects
        if (Object.keys(all[platform][slug]).length === 0) {
          delete all[platform][slug];
        }
        if (Object.keys(all[platform]).length === 0) {
          delete all[platform];
        }

        await storage.setItem(KEYS.AUTO_MAPPINGS, all);
      }
    });
  },

  async getAllForSlug(
    platform: string,
    slug: string
  ): Promise<PlatformMapping> {
    const all = await this.getAll();
    const entries = all[platform]?.[slug] ?? {};
    const now = Date.now();

    // Filter expired and extract values
    const result: PlatformMapping = {};
    for (const [targetPlatform, entry] of Object.entries(entries)) {
      if (entry.expires > now) {
        result[targetPlatform] = entry.value;
      }
    }
    return result;
  },

  flushExpired(): Promise<void> {
    return autoLock(async () => {
      const all = await this.getAll();
      const now = Date.now();
      let changed = false;

      for (const platform of Object.keys(all)) {
        for (const slug of Object.keys(all[platform])) {
          for (const targetPlatform of Object.keys(all[platform][slug])) {
            if (all[platform][slug][targetPlatform].expires < now) {
              delete all[platform][slug][targetPlatform];
              changed = true;
            }
          }
          if (Object.keys(all[platform][slug]).length === 0) {
            delete all[platform][slug];
          }
        }
        if (Object.keys(all[platform]).length === 0) {
          delete all[platform];
        }
      }

      if (changed) {
        await storage.setItem(KEYS.AUTO_MAPPINGS, all);
      }
    });
  },

  async clear(): Promise<void> {
    await storage.removeItem(KEYS.AUTO_MAPPINGS);
  },
};

/**
 * Platform data cache (with TTL)
 * Stored by TARGET platform: senkuro/van-pis → { chapter, lastChapterRead }
 * This way cache is shared across all requesting platforms
 */
export const cache = {
  async getAll(): Promise<AllCache> {
    return (await storage.getItem<AllCache>(KEYS.CACHE)) ?? {};
  },

  async get(
    targetPlatform: string,
    targetSlug: string
  ): Promise<CachedPlatformData | null> {
    const all = await this.getAll();
    const data = all[targetPlatform]?.[targetSlug];

    if (!data) return null;

    // Check TTL - lazy deletion (don't delete here, just return null)
    // Actual deletion happens in flushExpired() called periodically
    if (Date.now() > data.expires) {
      return null;
    }

    return data;
  },

  set(
    targetPlatform: string,
    targetSlug: string,
    data: Omit<CachedPlatformData, 'expires'>,
    ttl: number = DEFAULT_TTL
  ): Promise<void> {
    return cacheLock(async () => {
      try {
        const all = await this.getAll();

        if (!all[targetPlatform]) all[targetPlatform] = {};

        all[targetPlatform][targetSlug] = {
          ...data,
          expires: Date.now() + ttl,
        };

        await storage.setItem(KEYS.CACHE, all);
      } catch (error) {
        Logger.error('Storage', 'Failed to save cache', error);
        throw error;
      }
    });
  },

  delete(targetPlatform: string, targetSlug: string): Promise<void> {
    return cacheLock(async () => {
      const all = await this.getAll();

      if (all[targetPlatform]?.[targetSlug]) {
        delete all[targetPlatform][targetSlug];

        // Clean up empty objects
        if (Object.keys(all[targetPlatform]).length === 0) {
          delete all[targetPlatform];
        }

        await storage.setItem(KEYS.CACHE, all);
      }
    });
  },

  flushExpired(): Promise<void> {
    return cacheLock(async () => {
      const all = await this.getAll();
      const now = Date.now();
      let changed = false;

      for (const targetPlatform of Object.keys(all)) {
        for (const targetSlug of Object.keys(all[targetPlatform])) {
          if (all[targetPlatform][targetSlug].expires < now) {
            delete all[targetPlatform][targetSlug];
            changed = true;
          }
        }
        if (Object.keys(all[targetPlatform]).length === 0) {
          delete all[targetPlatform];
        }
      }

      if (changed) {
        await storage.setItem(KEYS.CACHE, all);
      }
    });
  },

  async clear(): Promise<void> {
    await storage.removeItem(KEYS.CACHE);
  },
};

/**
 * Get target slug with priority: manual > auto > null
 * Returns { slug, source } where source indicates where it came from
 */
export async function getTargetSlug(
  fromPlatform: string,
  slug: string,
  toPlatform: string
): Promise<{ slug: MappingValue | null; source: 'manual' | 'auto' | 'none' }> {
  // 1. Manual mappings (highest priority)
  const manual = await manualMappings.get(fromPlatform, slug, toPlatform);
  if (manual !== null) {
    return { slug: manual, source: 'manual' };
  }

  // 2. Auto-discovered mappings (can be string or false)
  const auto = await autoMappings.get(fromPlatform, slug, toPlatform);
  if (auto !== null) {
    return { slug: auto, source: 'auto' };
  }

  // 3. Not found - need to search
  return { slug: null, source: 'none' };
}

/**
 * Clear all storage
 */
export async function clearAll(): Promise<void> {
  await Promise.all([
    storage.removeItem(KEYS.MANUAL_MAPPINGS),
    storage.removeItem(KEYS.AUTO_MAPPINGS),
    storage.removeItem(KEYS.CACHE),
    storage.removeItem(KEYS.TOKENS),
  ]);
}

/**
 * User reading progress (local only)
 * Stores lastChapterRead per platform/slug
 * Used for platforms that store progress in localStorage (e.g., MangaBuff)
 */
export const userProgress = {
  async get(platform: PlatformKey, slug: string): Promise<number> {
    const all = await storage.getItem<Record<string, Record<string, number>>>('local:progress');
    return all?.[platform]?.[slug] ?? 0;
  },

  async set(platform: PlatformKey, slug: string, chapter: number): Promise<void> {
    try {
      const all = (await storage.getItem<Record<string, Record<string, number>>>('local:progress')) ?? {};
      if (!all[platform]) all[platform] = {};
      all[platform][slug] = chapter;
      await storage.setItem('local:progress', all);
    } catch (error) {
      Logger.error('Storage', `Failed to save progress for ${platform}/${slug}`, error);
    }
  },
};

/**
 * Platform auth tokens (local only)
 * Each platform stores its own token
 */
export const tokens = {
  async get(platform: string): Promise<string | null> {
    const all = await storage.getItem<Record<string, string>>(KEYS.TOKENS);
    return all?.[platform] ?? null;
  },

  async set(platform: string, token: string): Promise<void> {
    try {
      const all =
        (await storage.getItem<Record<string, string>>(KEYS.TOKENS)) ?? {};
      all[platform] = token;
      await storage.setItem(KEYS.TOKENS, all);
    } catch (error) {
      Logger.error('Storage', `Failed to save token for ${platform}`, error);
      throw error;
    }
  },

  async delete(platform: string): Promise<void> {
    const all =
      (await storage.getItem<Record<string, string>>(KEYS.TOKENS)) ?? {};
    delete all[platform];
    await storage.setItem(KEYS.TOKENS, all);
  },

  async clear(): Promise<void> {
    await storage.removeItem(KEYS.TOKENS);
  },
};
