/**
 * Zustand store for platform mappings
 * Syncs with chrome.storage automatically
 */
import { create } from 'zustand';
import {
  manualMappings,
  autoMappings,
  cache,
  getTargetSlug,
} from '@/src/utils/storage';
import { Logger } from '@/src/utils/logger';
import type {
  PlatformMapping,
  CachedPlatformData,
  SlugSource,
  MappingValue,
} from '@/src/types';

interface MappingsState {
  // Current context
  currentPlatform: string | null;
  currentSlug: string | null;

  // Loaded data for current slug
  manualLinks: PlatformMapping;
  autoLinks: PlatformMapping;
  cachedResults: Record<string, CachedPlatformData | null>;

  // Loading states
  loading: boolean;
  loadingPlatforms: Set<string>;

  // Actions
  setContext: (platform: string, slug: string) => Promise<void>;
  loadCachedResult: (targetPlatform: string) => Promise<CachedPlatformData | null>;

  // Manual link management
  saveManualLink: (targetPlatform: string, targetSlug: string) => Promise<void>;
  deleteManualLink: (targetPlatform: string) => Promise<void>;

  // Cache management
  cacheResult: (
    targetPlatform: string,
    targetSlug: string,
    data: Omit<CachedPlatformData, 'expires'>
  ) => Promise<void>;
  invalidateCache: (targetPlatform: string, targetSlug: string) => Promise<void>;

  // Auto mapping (after search)
  saveAutoMapping: (targetPlatform: string, targetSlug: MappingValue) => Promise<void>;
  deleteAutoMapping: (targetPlatform: string) => Promise<void>;

  // Loading state management
  setLoading: (targetPlatform: string, loading: boolean) => void;

  // Helpers
  getSlugWithSource: (targetPlatform: string) => Promise<{ slug: MappingValue | null; source: SlugSource }>;
  isLoading: (targetPlatform: string) => boolean;

  // Reset
  reset: () => void;
}

export const useMappingsStore = create<MappingsState>((set, get) => ({
  currentPlatform: null,
  currentSlug: null,
  manualLinks: {},
  autoLinks: {},
  cachedResults: {},
  loading: false,
  loadingPlatforms: new Set(),

  /**
   * Set current manga context and load all mappings
   */
  setContext: async (platform: string, slug: string) => {
    set({ loading: true, currentPlatform: platform, currentSlug: slug });

    try {
      const [manual, auto] = await Promise.all([
        manualMappings.getAllForSlug(platform, slug),
        autoMappings.getAllForSlug(platform, slug),
      ]);

      set({
        manualLinks: manual,
        autoLinks: auto,
        cachedResults: {},
        loading: false,
      });
    } catch (error) {
      Logger.error('MappingsStore', 'Failed to load mappings', error);
      set({
        manualLinks: {},
        autoLinks: {},
        cachedResults: {},
        loading: false,
      });
    }
  },

  /**
   * Load cached result for a target platform
   * First resolves targetSlug from mappings, then gets cache
   */
  loadCachedResult: async (targetPlatform: string) => {
    const { currentPlatform, currentSlug, loadingPlatforms } = get();
    if (!currentPlatform || !currentSlug) return null;

    // Mark as loading
    const newLoading = new Set(loadingPlatforms);
    newLoading.add(targetPlatform);
    set({ loadingPlatforms: newLoading });

    try {
      // First get targetSlug from mappings
      const { slug: targetSlug } = await getTargetSlug(
        currentPlatform,
        currentSlug,
        targetPlatform
      );

      // If no mapping or mapping is false (not found), no cache
      if (!targetSlug) {
        set((state) => ({
          cachedResults: {
            ...state.cachedResults,
            [targetPlatform]: null,
          },
        }));
        return null;
      }

      // Get cache by target platform and slug
      const result = await cache.get(targetPlatform, targetSlug);

      set((state) => ({
        cachedResults: {
          ...state.cachedResults,
          [targetPlatform]: result,
        },
      }));

      return result;
    } catch (error) {
      Logger.error('MappingsStore', `Failed to load cache for ${targetPlatform}`, error);
      set((state) => ({
        cachedResults: {
          ...state.cachedResults,
          [targetPlatform]: null,
        },
      }));
      return null;
    } finally {
      // Remove from loading
      set((state) => {
        const updated = new Set(state.loadingPlatforms);
        updated.delete(targetPlatform);
        return { loadingPlatforms: updated };
      });
    }
  },

  /**
   * Save manual link (user-defined)
   */
  saveManualLink: async (targetPlatform: string, targetSlug: string) => {
    const { currentPlatform, currentSlug } = get();
    if (!currentPlatform || !currentSlug) return;

    await manualMappings.set(
      currentPlatform,
      currentSlug,
      targetPlatform,
      targetSlug
    );

    // Clear cached result in state (cache itself is shared, don't delete it)
    set((state) => ({
      manualLinks: {
        ...state.manualLinks,
        [targetPlatform]: targetSlug,
      },
      cachedResults: {
        ...state.cachedResults,
        [targetPlatform]: null,
      },
    }));
  },

  /**
   * Delete manual link
   */
  deleteManualLink: async (targetPlatform: string) => {
    const { currentPlatform, currentSlug, manualLinks } = get();
    if (!currentPlatform || !currentSlug) return;

    await manualMappings.delete(currentPlatform, currentSlug, targetPlatform);

    const updated = { ...manualLinks };
    delete updated[targetPlatform];

    // Clear cached result in state (cache itself is shared, don't delete it)
    set({
      manualLinks: updated,
      cachedResults: {
        ...get().cachedResults,
        [targetPlatform]: null,
      },
    });
  },

  /**
   * Cache search result
   * Cache is stored by target platform (shared across all requesting platforms)
   */
  cacheResult: async (
    targetPlatform: string,
    targetSlug: string,
    data: Omit<CachedPlatformData, 'expires'>
  ) => {
    await cache.set(targetPlatform, targetSlug, data);

    const cached = await cache.get(targetPlatform, targetSlug);

    set((state) => ({
      cachedResults: {
        ...state.cachedResults,
        [targetPlatform]: cached,
      },
    }));
  },

  /**
   * Invalidate cache for platform
   * Takes targetSlug because cache is stored by target, not source
   */
  invalidateCache: async (targetPlatform: string, targetSlug: string) => {
    await cache.delete(targetPlatform, targetSlug);

    set((state) => ({
      cachedResults: {
        ...state.cachedResults,
        [targetPlatform]: null,
      },
    }));
  },

  /**
   * Save auto-discovered mapping
   * Can save false if search found nothing (prevents API spam)
   */
  saveAutoMapping: async (targetPlatform: string, targetSlug: MappingValue) => {
    const { currentPlatform, currentSlug } = get();
    if (!currentPlatform || !currentSlug) return;

    await autoMappings.set(
      currentPlatform,
      currentSlug,
      targetPlatform,
      targetSlug
    );

    set((state) => ({
      autoLinks: {
        ...state.autoLinks,
        [targetPlatform]: targetSlug,
      },
    }));
  },

  /**
   * Delete auto mapping (to allow re-search)
   */
  deleteAutoMapping: async (targetPlatform: string) => {
    const { currentPlatform, currentSlug, autoLinks } = get();
    if (!currentPlatform || !currentSlug) return;

    await autoMappings.delete(currentPlatform, currentSlug, targetPlatform);

    const updated = { ...autoLinks };
    delete updated[targetPlatform];

    set({ autoLinks: updated });
  },

  /**
   * Get target slug with source info (manual > auto > none)
   * Returns MappingValue which can be string or false (not found)
   */
  getSlugWithSource: async (targetPlatform: string): Promise<{ slug: MappingValue | null; source: SlugSource }> => {
    const { currentPlatform, currentSlug, manualLinks, autoLinks } = get();
    if (!currentPlatform || !currentSlug) {
      return { slug: null, source: 'none' };
    }

    // 1. Manual (highest priority) - only strings
    const manual = manualLinks[targetPlatform];
    if (typeof manual === 'string') {
      return { slug: manual, source: 'manual' };
    }

    // 2. Auto-discovered (can be string or false)
    const auto = autoLinks[targetPlatform];
    if (auto !== undefined) {
      return { slug: auto, source: 'auto' };
    }

    // 3. Not found - need to search
    return { slug: null, source: 'none' };
  },

  /**
   * Set loading state for a platform
   */
  setLoading: (targetPlatform: string, loading: boolean) => {
    set((state) => {
      const updated = new Set(state.loadingPlatforms);
      if (loading) {
        updated.add(targetPlatform);
      } else {
        updated.delete(targetPlatform);
      }
      return { loadingPlatforms: updated };
    });
  },

  /**
   * Check if platform is loading
   */
  isLoading: (targetPlatform: string) => {
    return get().loadingPlatforms.has(targetPlatform);
  },

  /**
   * Reset store to initial state
   */
  reset: () => {
    set({
      currentPlatform: null,
      currentSlug: null,
      manualLinks: {},
      autoLinks: {},
      cachedResults: {},
      loading: false,
      loadingPlatforms: new Set(),
    });
  },
}));
