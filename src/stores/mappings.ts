/**
 * Zustand store for platform mappings — backed by Manga Node graph.
 *
 * UI continues to read `manualLinks` / `autoLinks` / `disabled` / `offsets` from state,
 * but underneath all mutations go through node graph (nodeStorage + addOrMergeSlug).
 */
import { create } from 'zustand';
import { cache, getTargetSlug } from '@/src/utils/storage';
import {
  nodeStore,
  ensureNode,
  addOrMergeSlug,
} from '@/src/utils/nodeStorage';
import { Logger } from '@/src/utils/logger';
import type {
  PlatformMapping,
  CachedPlatformData,
  SlugSource,
  MappingValue,
  MangaNode,
  PlatformKey,
} from '@/src/types';

interface MappingsState {
  currentPlatform: PlatformKey | null;
  currentSlug: string | null;
  nodeId: string | null;

  // Derived from current node — kept on state for UI reactivity
  manualLinks: PlatformMapping;     // only where source='manual'
  autoLinks: PlatformMapping;       // only where source='auto'
  offsets: Partial<Record<PlatformKey, number>>;
  disabled: Partial<Record<PlatformKey, true>>;
  cachedResults: Partial<Record<PlatformKey, CachedPlatformData | null>>;

  loading: boolean;
  loadingPlatforms: Set<PlatformKey>;

  // Actions — R4.1: all platform params typed as PlatformKey
  setContext: (platform: PlatformKey, slug: string) => Promise<void>;
  refreshFromNode: () => Promise<void>;
  loadCachedResult: (targetPlatform: PlatformKey) => Promise<CachedPlatformData | null>;

  saveManualLink: (targetPlatform: PlatformKey, targetSlug: MappingValue) => Promise<void>;
  deleteManualLink: (targetPlatform: PlatformKey) => Promise<void>;

  cacheResult: (
    targetPlatform: PlatformKey,
    targetSlug: string,
    data: Omit<CachedPlatformData, 'expires'>
  ) => Promise<void>;
  invalidateCache: (targetPlatform: PlatformKey, targetSlug: string) => Promise<void>;

  saveAutoMapping: (targetPlatform: PlatformKey, targetSlug: MappingValue) => Promise<void>;
  deleteAutoMapping: (targetPlatform: PlatformKey) => Promise<void>;

  setOffset: (targetPlatform: PlatformKey, value: number) => Promise<void>;
  setDisabled: (targetPlatform: PlatformKey, value: boolean) => Promise<void>;

  setLoading: (targetPlatform: PlatformKey, loading: boolean) => void;
  getSlugWithSource: (targetPlatform: PlatformKey) => Promise<{ slug: MappingValue | null; source: SlugSource }>;
  isLoading: (targetPlatform: PlatformKey) => boolean;

  reset: () => void;
}

type NodeProjection = Pick<MappingsState, 'manualLinks' | 'autoLinks' | 'offsets' | 'disabled'>;

// R2.1: cache projection per-node identity so Zustand shallow-check passes and
// subscribers to `offsets` / `disabled` don't re-render when underlying node
// is unchanged. Mutations always return a new node object, so identity is safe.
let lastProjectedNode: MangaNode | null = null;
let lastProjection: NodeProjection | null = null;

/** Project a node into UI-friendly shape (manualLinks/autoLinks/offsets/disabled). */
function projectNode(node: MangaNode | null): NodeProjection {
  if (node === lastProjectedNode && lastProjection) return lastProjection;

  const manualLinks: PlatformMapping = {};
  const autoLinks: PlatformMapping = {};
  if (!node) {
    const empty: NodeProjection = { manualLinks, autoLinks, offsets: {}, disabled: {} };
    lastProjectedNode = null;
    lastProjection = empty;
    return empty;
  }

  for (const [platform, slug] of Object.entries(node.slugs)) {
    if (slug === undefined) continue;
    const pk = platform as PlatformKey;
    const src = node.source[pk];
    if (src === 'manual') manualLinks[pk] = slug;
    else autoLinks[pk] = slug;
  }
  const projected: NodeProjection = {
    manualLinks,
    autoLinks,
    offsets: { ...node.offsets },
    disabled: { ...node.disabled },
  };
  lastProjectedNode = node;
  lastProjection = projected;
  return projected;
}

export const useMappingsStore = create<MappingsState>((set, get) => ({
  currentPlatform: null,
  currentSlug: null,
  nodeId: null,

  manualLinks: {},
  autoLinks: {},
  offsets: {},
  disabled: {},
  cachedResults: {},
  loading: false,
  loadingPlatforms: new Set(),

  setContext: async (platform: PlatformKey, slug: string) => {
    set({ loading: true, currentPlatform: platform, currentSlug: slug });

    try {
      const node = await nodeStore.resolveByTuple(platform, slug);
      const projected = projectNode(node);
      set({
        nodeId: node?.id ?? null,
        ...projected,
        cachedResults: {},
        loading: false,
      });
      if (node) {
        nodeStore.touchLastAccessed(node.id);
      }
    } catch (error) {
      Logger.error('MappingsStore', 'Failed to load node', error);
      set({
        nodeId: null,
        manualLinks: {},
        autoLinks: {},
        offsets: {},
        disabled: {},
        cachedResults: {},
        loading: false,
      });
    }
  },

  /** Re-read current node from storage and project into state. */
  refreshFromNode: async () => {
    const { currentPlatform, currentSlug } = get();
    if (!currentPlatform || !currentSlug) return;
    const node = await nodeStore.resolveByTuple(currentPlatform, currentSlug);
    const projected = projectNode(node);
    set({ nodeId: node?.id ?? null, ...projected });
  },

  loadCachedResult: async (targetPlatform: PlatformKey) => {
    const { currentPlatform, currentSlug, loadingPlatforms } = get();
    if (!currentPlatform || !currentSlug) return null;

    const newLoading = new Set(loadingPlatforms);
    newLoading.add(targetPlatform);
    set({ loadingPlatforms: newLoading });

    try {
      const { slug: targetSlug } = await getTargetSlug(
        currentPlatform,
        currentSlug,
        targetPlatform
      );

      if (!targetSlug) {
        set((state) => ({
          cachedResults: { ...state.cachedResults, [targetPlatform]: null },
        }));
        return null;
      }

      const result = await cache.get(targetPlatform, targetSlug);
      set((state) => ({
        cachedResults: { ...state.cachedResults, [targetPlatform]: result },
      }));
      return result;
    } catch (error) {
      Logger.error('MappingsStore', `Failed to load cache for ${targetPlatform}`, error);
      set((state) => ({
        cachedResults: { ...state.cachedResults, [targetPlatform]: null },
      }));
      return null;
    } finally {
      set((state) => {
        const updated = new Set(state.loadingPlatforms);
        updated.delete(targetPlatform);
        return { loadingPlatforms: updated };
      });
    }
  },

  saveManualLink: async (targetPlatform: PlatformKey, targetSlug: MappingValue) => {
    const { currentPlatform, currentSlug } = get();
    if (!currentPlatform || !currentSlug) return;

    // R2.6: use node returned from addOrMergeSlug — no second read/project.
    const { node } = await addOrMergeSlug(
      currentPlatform,
      currentSlug,
      targetPlatform,
      targetSlug,
      'manual'
    );
    set((state) => ({
      nodeId: node.id,
      ...projectNode(node),
      cachedResults: { ...state.cachedResults, [targetPlatform]: null },
    }));
  },

  deleteManualLink: async (targetPlatform: PlatformKey) => {
    const { nodeId } = get();
    if (!nodeId) return;
    await nodeStore.deleteSlot(nodeId, targetPlatform, 'manual');
    await get().refreshFromNode();
    set((state) => ({
      cachedResults: { ...state.cachedResults, [targetPlatform]: null },
    }));
  },

  cacheResult: async (targetPlatform, targetSlug, data) => {
    await cache.set(targetPlatform, targetSlug, data);
    const cached = await cache.get(targetPlatform, targetSlug);
    set((state) => ({
      cachedResults: { ...state.cachedResults, [targetPlatform]: cached },
    }));
  },

  invalidateCache: async (targetPlatform: PlatformKey, targetSlug: string) => {
    await cache.delete(targetPlatform, targetSlug);
    set((state) => ({
      cachedResults: { ...state.cachedResults, [targetPlatform]: null },
    }));
  },

  saveAutoMapping: async (targetPlatform: PlatformKey, targetSlug: MappingValue) => {
    const { currentPlatform, currentSlug } = get();
    if (!currentPlatform || !currentSlug) return;

    const { node } = await addOrMergeSlug(
      currentPlatform,
      currentSlug,
      targetPlatform,
      targetSlug,
      'auto'
    );
    set({ nodeId: node.id, ...projectNode(node) });
  },

  deleteAutoMapping: async (targetPlatform: PlatformKey) => {
    const { nodeId } = get();
    if (!nodeId) return;
    await nodeStore.deleteSlot(nodeId, targetPlatform, 'auto');
    await get().refreshFromNode();
  },

  setOffset: async (targetPlatform: PlatformKey, value: number) => {
    const { currentPlatform, currentSlug } = get();
    if (!currentPlatform || !currentSlug) return;
    const nodeId = await ensureNode(currentPlatform, currentSlug);
    // F2.4: updateNode returns the fresh node — use it directly, no second read
    const node = await nodeStore.updateNode(nodeId, (n) => {
      if (value === 0) delete n.offsets[targetPlatform];
      else n.offsets[targetPlatform] = value;
    });
    set({ nodeId: node?.id ?? null, ...projectNode(node) });
  },

  setDisabled: async (targetPlatform: PlatformKey, value: boolean) => {
    const { currentPlatform, currentSlug } = get();
    if (!currentPlatform || !currentSlug) return;
    const nodeId = await ensureNode(currentPlatform, currentSlug);
    const node = await nodeStore.updateNode(nodeId, (n) => {
      if (value) n.disabled[targetPlatform] = true;
      else delete n.disabled[targetPlatform];
    });
    set({ nodeId: node?.id ?? null, ...projectNode(node) });
  },

  getSlugWithSource: async (targetPlatform: PlatformKey) => {
    const { currentPlatform, currentSlug } = get();
    if (!currentPlatform || !currentSlug) return { slug: null, source: 'none' };
    return getTargetSlug(currentPlatform, currentSlug, targetPlatform);
  },

  setLoading: (targetPlatform: PlatformKey, loading: boolean) => {
    set((state) => {
      const updated = new Set(state.loadingPlatforms);
      if (loading) updated.add(targetPlatform);
      else updated.delete(targetPlatform);
      return { loadingPlatforms: updated };
    });
  },

  isLoading: (targetPlatform: PlatformKey) => {
    return get().loadingPlatforms.has(targetPlatform);
  },

  reset: () => {
    set({
      currentPlatform: null,
      currentSlug: null,
      nodeId: null,
      manualLinks: {},
      autoLinks: {},
      offsets: {},
      disabled: {},
      cachedResults: {},
      loading: false,
      loadingPlatforms: new Set(),
    });
  },
}));
