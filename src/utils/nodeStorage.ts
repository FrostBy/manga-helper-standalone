/**
 * Manga Node graph storage
 *
 * Layout (all in chrome.storage.local):
 * - local:nodes     Record<nodeId, MangaNode>
 * - local:slugIndex Record<PlatformKey, Record<slug, nodeId>>
 *
 * Invariants:
 * - 1 manga = 1 node, regardless of platforms
 * - slugIndex is derivable from nodes (rebuildSlugIndex())
 * - Priority in resolve: disabled > manual > auto(string) > auto(false+TTL) > null
 */
import { storage } from '@wxt-dev/storage';
import { Logger } from './logger';
import { isPlatformKey, safeEntries, emptyRecord } from './platformKeys';
import type {
  MangaNode,
  NodesMap,
  SlugIndex,
  MappingValue,
  PlatformKey,
} from '@/src/types';

const KEY_NODES = 'local:nodes';
const KEY_INDEX = 'local:slugIndex';

/** TTL for negative cache (auto-search found nothing). */
export const AUTO_FALSE_TTL = 60 * 60 * 1000; // 1h

import { createLock } from './lock';
/** Serialize writes across nodes/index to avoid race conditions. */
const writeLock = createLock();

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ============================================
// F2.1: Batched touchLastAccessed
// Accumulate touched nodeIds in a Set, flush together after idle delay (one write)
// ============================================

const pendingTouches = new Set<string>();
const TOUCH_FLUSH_DELAY_MS = 5000;
let touchFlushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleTouchFlush(): void {
  if (touchFlushTimer) return;
  touchFlushTimer = setTimeout(() => {
    touchFlushTimer = null;
    flushPendingTouches().catch((err) => Logger.warn('NodeStorage', 'touch flush failed', err));
  }, TOUCH_FLUSH_DELAY_MS);
}

async function flushPendingTouches(): Promise<void> {
  if (pendingTouches.size === 0) return;
  const ids = Array.from(pendingTouches);
  pendingTouches.clear();
  await lockedRun(async () => {
    const nodes = await getAllNodes();
    const now = Date.now();
    let touched = 0;
    for (const id of ids) {
      const n = nodes[id];
      if (!n) continue;
      n.lastAccessedAt = now;
      touched++;
    }
    if (touched > 0) await setAllNodes(nodes);
  });
}

// ============================================
// Batch mode (F1.5)
// While `batchSnap` is set, reads return the shared snapshot and writes mutate it
// in-place without I/O. A single atomic flush happens in `withBatch`.
// All lock-wrapped ops use `lockedRun` which skips the lock when already inside a batch.
// ============================================

let batchSnap: { nodes: NodesMap; index: SlugIndex } | null = null;

function lockedRun<T>(fn: () => Promise<T>): Promise<T> {
  if (batchSnap) return fn();
  return writeLock(fn);
}

// ============================================
// Raw storage access (batch-aware)
// ============================================

async function getAllNodes(): Promise<NodesMap> {
  if (batchSnap) return batchSnap.nodes;
  return (await storage.getItem<NodesMap>(KEY_NODES)) ?? {};
}

async function getAllIndex(): Promise<SlugIndex> {
  if (batchSnap) return batchSnap.index;
  return (await storage.getItem<SlugIndex>(KEY_INDEX)) ?? {};
}

async function setAllNodes(nodes: NodesMap): Promise<void> {
  if (batchSnap) {
    batchSnap.nodes = nodes;
    return;
  }
  await storage.setItem(KEY_NODES, nodes);
}

async function setAllIndex(index: SlugIndex): Promise<void> {
  if (batchSnap) {
    batchSnap.index = index;
    return;
  }
  await storage.setItem(KEY_INDEX, index);
}

/**
 * Execute fn inside a batch: one read on entry, one write on exit, all internal
 * addOrMergeSlug / updateNode / deleteSlot mutations happen in-memory.
 */
export async function withBatch<T>(fn: () => Promise<T>): Promise<T> {
  return writeLock(async () => {
    const [nodes, index] = await Promise.all([
      (await storage.getItem<NodesMap>(KEY_NODES)) ?? {},
      (await storage.getItem<SlugIndex>(KEY_INDEX)) ?? {},
    ]);
    batchSnap = { nodes, index };
    try {
      const result = await fn();
      await storage.setItem(KEY_NODES, batchSnap.nodes);
      await storage.setItem(KEY_INDEX, batchSnap.index);
      return result;
    } finally {
      batchSnap = null;
    }
  });
}

// ============================================
// Public read API
// ============================================

export const nodeStore = {
  async getAll(): Promise<NodesMap> {
    return getAllNodes();
  },

  async get(nodeId: string): Promise<MangaNode | null> {
    const all = await getAllNodes();
    return all[nodeId] ?? null;
  },

  /** Resolve node by (platform, slug). Returns null if not indexed. */
  async resolveByTuple(platform: PlatformKey, slug: string): Promise<MangaNode | null> {
    const [nodes, index] = await Promise.all([getAllNodes(), getAllIndex()]);
    const nodeId = index[platform]?.[slug];
    if (!nodeId) return null;
    return nodes[nodeId] ?? null;
  },

  /**
   * F2.1: Update lastAccessedAt lazily. Accumulates node ids in memory and flushes
   * the whole batch after a short idle window (5s). If flush not yet run when
   * extension is torn down we simply lose the touch — acceptable for LRU metadata.
   */
  touchLastAccessed(nodeId: string): void {
    pendingTouches.add(nodeId);
    scheduleTouchFlush();
  },

  /** Flush pending touches NOW (used in tests and before explicit snapshots). */
  async flushTouches(): Promise<void> {
    await flushPendingTouches();
  },

  /** Rebuild slugIndex from nodes (used on corrupt or migration). */
  async rebuildSlugIndex(): Promise<void> {
    return lockedRun(async () => {
      const nodes = await getAllNodes();
      const index: SlugIndex = {};
      for (const [nodeId, node] of Object.entries(nodes)) {
        for (const [p, slug] of safeEntries<MappingValue>(node.slugs)) {
          if (typeof slug !== 'string') continue;
          const bucket = index[p] ?? (index[p] = emptyRecord<string>());
          bucket[slug] = nodeId;
        }
      }
      await setAllIndex(index);
    });
  },

  /** Direct update by id (for offsets/disabled/manual setters in mappings store). */
  async updateNode(nodeId: string, updater: (n: MangaNode) => void): Promise<MangaNode | null> {
    return lockedRun(async () => {
      const nodes = await getAllNodes();
      const node = nodes[nodeId];
      if (!node) return null;
      updater(node);
      node.updatedAt = Date.now();
      await setAllNodes(nodes);
      return node;
    });
  },

  /**
   * F1.3: Clear a platform slot (slug/expires/source) on a node AND remove the old string slug
   * from slugIndex atomically. If `onlySource` given, only deletes when node.source[platform] matches.
   */
  async deleteSlot(nodeId: string, platform: PlatformKey, onlySource?: 'manual' | 'auto'): Promise<void> {
    return lockedRun(async () => {
      const [nodes, index] = await Promise.all([getAllNodes(), getAllIndex()]);
      const node = nodes[nodeId];
      if (!node) return;
      if (onlySource && node.source[platform] !== onlySource) return;
      const prev = node.slugs[platform];
      delete node.slugs[platform];
      delete node.expires[platform];
      delete node.source[platform];
      node.updatedAt = Date.now();
      if (typeof prev === 'string') {
        const bucket = index[platform];
        if (bucket && bucket[prev] === nodeId) delete bucket[prev];
      }
      await Promise.all([setAllNodes(nodes), setAllIndex(index)]);
    });
  },

  /**
   * R1.3: Full reset of a platform slot — clears slug/source/expires AND offsets/disabled.
   * Used when user clicks "Delete" to fully remove platform state (not just the slug).
   */
  async resetPlatformSlot(nodeId: string, platform: PlatformKey): Promise<void> {
    return lockedRun(async () => {
      const [nodes, index] = await Promise.all([getAllNodes(), getAllIndex()]);
      const node = nodes[nodeId];
      if (!node) return;
      const prev = node.slugs[platform];
      delete node.slugs[platform];
      delete node.expires[platform];
      delete node.source[platform];
      delete node.offsets[platform];
      delete node.disabled[platform];
      node.updatedAt = Date.now();
      if (typeof prev === 'string') {
        const bucket = index[platform];
        if (bucket && bucket[prev] === nodeId) delete bucket[prev];
      }
      await Promise.all([setAllNodes(nodes), setAllIndex(index)]);
    });
  },

  /** Delete a node completely + remove its slugs from index. */
  async deleteNode(nodeId: string): Promise<void> {
    return lockedRun(async () => {
      const [nodes, index] = await Promise.all([getAllNodes(), getAllIndex()]);
      const node = nodes[nodeId];
      if (!node) return;
      for (const [p, slug] of safeEntries<MappingValue>(node.slugs)) {
        if (typeof slug !== 'string') continue;
        if (index[p]?.[slug] === nodeId) delete index[p]![slug];
      }
      delete nodes[nodeId];
      await Promise.all([setAllNodes(nodes), setAllIndex(index)]);
    });
  },
};

/**
 * Ensure a node exists for (platform, slug). Creates a single-slug node if needed.
 * Returns the nodeId. Used by stores when we need a node before any target resolution.
 */
export async function ensureNode(
  platform: PlatformKey,
  slug: string
): Promise<string> {
  if (!isPlatformKey(platform)) throw new Error(`ensureNode: invalid platform key ${platform}`);
  return lockedRun(async () => {
    const [nodes, index] = await Promise.all([getAllNodes(), getAllIndex()]);
    const existing = index[platform]?.[slug];
    if (existing && nodes[existing]) return existing;

    const id = genId();
    const now = Date.now();
    const node: MangaNode = {
      id,
      slugs: Object.assign(Object.create(null), { [platform]: slug }),
      expires: Object.create(null),
      offsets: Object.create(null),
      disabled: Object.create(null),
      source: Object.create(null),
      updatedAt: now,
      lastAccessedAt: now,
    };
    nodes[id] = node;
    const bucket = index[platform] ?? (index[platform] = emptyRecord<string>());
    bucket[slug] = id;
    await Promise.all([setAllNodes(nodes), setAllIndex(index)]);
    return id;
  });
}

// ============================================
// addOrMergeSlug — core mutation
// ============================================

/**
 * Add a (source→target slug) mapping to the graph.
 * Creates/merges nodes as needed. Returns the affected nodeId.
 *
 * Cases:
 * - A: both tuples point to the same node → update
 * - B: one tuple exists → add slug to that node
 * - C: neither exists → create new node with both
 * - D: different nodes → merge (union, last-write-wins on conflicts)
 *
 * `sourceKind='manual'` writes unconditionally.
 * `sourceKind='auto'` does NOT override an existing source='manual' slug.
 */
/**
 * R2.6: returns the freshly-mutated node along with its id so callers can
 * project to UI without an extra `resolveByTuple` round-trip.
 */
export interface AddOrMergeResult {
  nodeId: string;
  node: MangaNode;
}

export async function addOrMergeSlug(
  sourcePlatform: PlatformKey,
  sourceSlug: string,
  targetPlatform: PlatformKey,
  targetSlug: MappingValue,
  sourceKind: 'manual' | 'auto'
): Promise<AddOrMergeResult> {
  if (!isPlatformKey(sourcePlatform) || !isPlatformKey(targetPlatform)) {
    Logger.warn('NodeStorage', 'addOrMergeSlug: invalid platform key', { sourcePlatform, targetPlatform });
    throw new Error(`Invalid platform key`);
  }
  return lockedRun(async () => {
    const [nodes, index] = await Promise.all([getAllNodes(), getAllIndex()]);
    const now = Date.now();

    const sourceNodeId = index[sourcePlatform]?.[sourceSlug] ?? null;
    const targetNodeId =
      typeof targetSlug === 'string' ? (index[targetPlatform]?.[targetSlug] ?? null) : null;

    // --- Case C: neither exists → create a new node with both slugs
    if (!sourceNodeId && !targetNodeId) {
      const id = genId();
      const node: MangaNode = {
        id,
        slugs: Object.assign(Object.create(null), {
          [sourcePlatform]: sourceSlug,
          [targetPlatform]: targetSlug,
        }),
        expires: typeof targetSlug === 'string'
          ? Object.create(null)
          : Object.assign(Object.create(null), { [targetPlatform]: now + AUTO_FALSE_TTL }),
        offsets: Object.create(null),
        disabled: Object.create(null),
        source: Object.assign(Object.create(null), { [targetPlatform]: sourceKind }),
        updatedAt: now,
        lastAccessedAt: now,
      };
      nodes[id] = node;
      const srcBucket = index[sourcePlatform] ?? (index[sourcePlatform] = emptyRecord<string>());
      srcBucket[sourceSlug] = id;
      if (typeof targetSlug === 'string') {
        const tgtBucket = index[targetPlatform] ?? (index[targetPlatform] = emptyRecord<string>());
        tgtBucket[targetSlug] = id;
      }
      await Promise.all([setAllNodes(nodes), setAllIndex(index)]);
      return { nodeId: id, node };
    }

    // --- Case A/B: one side exists, the other missing → extend same node
    if (sourceNodeId && !targetNodeId) {
      return await extendNode(nodes, index, sourceNodeId, targetPlatform, targetSlug, sourceKind, now);
    }
    if (!sourceNodeId && targetNodeId) {
      return await extendNode(nodes, index, targetNodeId, sourcePlatform, sourceSlug, sourceKind, now, { flipSide: true, targetPlatform, targetSlug });
    }

    // --- Case A: same node on both sides → update
    if (sourceNodeId === targetNodeId) {
      const node = nodes[sourceNodeId!];
      writeTargetSlotIfAllowed(node, targetPlatform, targetSlug, sourceKind, now, index, node.id);
      node.updatedAt = now;
      node.lastAccessedAt = now;
      await Promise.all([setAllNodes(nodes), setAllIndex(index)]);
      return { nodeId: node.id, node };
    }

    // --- Case D: different nodes → merge (keep sourceNodeId, absorb targetNodeId)
    const keepId = sourceNodeId!;
    const dropId = targetNodeId!;
    const keep = nodes[keepId];
    const drop = nodes[dropId];
    mergeInto(keep, drop);
    writeTargetSlotIfAllowed(keep, targetPlatform, targetSlug, sourceKind, now, index, keep.id);
    keep.updatedAt = now;
    keep.lastAccessedAt = now;

    // Re-point index from dropId → keepId
    for (const [p, slug] of safeEntries<MappingValue>(drop.slugs)) {
      if (typeof slug !== 'string') continue;
      const bucket = index[p] ?? (index[p] = emptyRecord<string>());
      bucket[slug] = keepId;
    }
    delete nodes[dropId];
    if (typeof targetSlug === 'string') {
      const bucket = index[targetPlatform] ?? (index[targetPlatform] = emptyRecord<string>());
      bucket[targetSlug] = keepId;
    }
    await Promise.all([setAllNodes(nodes), setAllIndex(index)]);
    Logger.debug('NodeStorage', `Merged node ${dropId} into ${keepId}`);
    return { nodeId: keepId, node: keep };
  });
}

async function extendNode(
  nodes: NodesMap,
  index: SlugIndex,
  nodeId: string,
  platform: PlatformKey,
  slug: MappingValue,
  sourceKind: 'manual' | 'auto',
  now: number,
  flip?: { flipSide: true; targetPlatform: PlatformKey; targetSlug: MappingValue }
): Promise<AddOrMergeResult> {
  const node = nodes[nodeId];
  if (!node) {
    // Safety fallback: should not happen, but callers get a coherent return
    return { nodeId, node: { id: nodeId, slugs: Object.create(null), expires: Object.create(null), offsets: Object.create(null), disabled: Object.create(null), source: Object.create(null), updatedAt: now, lastAccessedAt: now } };
  }

  if (flip) {
    // Adding source slug to an index-missing side; target already in node
    if (typeof slug === 'string') {
      // F1.1: write source slug into node.slugs so rebuildSlugIndex() can recreate the index
      node.slugs[platform] = slug;
      const bucket = index[platform] ?? (index[platform] = Object.create(null) as Record<string, string>);
      bucket[slug] = nodeId;
    }
    writeTargetSlotIfAllowed(node, flip.targetPlatform, flip.targetSlug, sourceKind, now, index, nodeId);
  } else {
    // Adding target slug (slug param) to node
    writeTargetSlotIfAllowed(node, platform, slug, sourceKind, now, index, nodeId);
    if (typeof slug === 'string') {
      const bucket = index[platform] ?? (index[platform] = Object.create(null) as Record<string, string>);
      bucket[slug] = nodeId;
    }
  }

  node.updatedAt = now;
  node.lastAccessedAt = now;
  await Promise.all([setAllNodes(nodes), setAllIndex(index)]);
  return { nodeId, node };
}

/**
 * Write slug+source for a target platform, respecting manual-priority rule.
 * F1.2: Auto does NOT override an existing manual slug of ANY kind (string OR false).
 * F1.3: When overwriting a string slug, drop it from slugIndex so stale entries don't linger.
 */
function writeTargetSlotIfAllowed(
  node: MangaNode,
  platform: PlatformKey,
  slug: MappingValue,
  sourceKind: 'manual' | 'auto',
  now: number,
  index?: SlugIndex,
  nodeId?: string
): void {
  const existingSource = node.source[platform];
  if (sourceKind === 'auto' && existingSource === 'manual') {
    Logger.debug('NodeStorage', `Skipping auto overwrite of manual slot for ${platform}`);
    return;
  }

  // Drop stale slugIndex entry if we replace a string with something else
  const prev = node.slugs[platform];
  if (index && nodeId && typeof prev === 'string' && prev !== slug) {
    const bucket = index[platform];
    if (bucket && bucket[prev] === nodeId) delete bucket[prev];
  }

  node.slugs[platform] = slug;
  node.source[platform] = sourceKind;
  if (slug === false) {
    node.expires[platform] = now + AUTO_FALSE_TTL;
  } else {
    delete node.expires[platform];
  }
}

/**
 * Merge all fields of `b` into `a` (keep `a`, absorb `b`).
 *
 * Conflict policy (R5.5 — documented explicitly):
 *  - **slugs**:    manual always beats auto; among same-kind, `bWins` (latest updatedAt).
 *                  string beats false (slug found is always preferred over "not found").
 *  - **offsets**:  last-write-wins via `bWins`. A user's latest edit of offset
 *                  always wins. No union — two nodes can't both "own" an offset.
 *  - **disabled**: union — if ANY side has `disabled[p]=true`, result has it.
 *                  Rationale: "once user disabled a platform, stay disabled"
 *                  even if the other node hadn't reached this state yet.
 *  - **lastAccessedAt**: max of both.
 */
function mergeInto(a: MangaNode, b: MangaNode): void {
  const bWins = b.updatedAt > a.updatedAt;

  for (const [p, slug] of safeEntries<MappingValue>(b.slugs)) {
    const existing = a.slugs[p];
    if (existing === undefined) {
      a.slugs[p] = slug;
      if (b.source[p]) a.source[p] = b.source[p];
      if (slug === false && b.expires[p]) a.expires[p] = b.expires[p];
    } else if (typeof existing === 'string' && slug === false) {
      // keep string
    } else if (existing === false && typeof slug === 'string') {
      // R1.4: auto must NOT override manual even when promoting false → string
      if (a.source[p] === 'manual' && b.source[p] === 'auto') continue;
      a.slugs[p] = slug;
      if (b.source[p]) a.source[p] = b.source[p];
      delete a.expires[p];
    } else if (a.source[p] === 'manual' && b.source[p] === 'auto') {
      // R1.4: manual beats auto regardless of updatedAt
      continue;
    } else if (bWins) {
      a.slugs[p] = slug;
      if (b.source[p]) a.source[p] = b.source[p];
      if (slug === false && b.expires[p]) a.expires[p] = b.expires[p];
      else delete a.expires[p];
    }
  }

  // F5.3 offsets: union; on conflict, bWins decides. Document: user intent last-wins by timestamp.
  for (const [p, offset] of safeEntries<number>(b.offsets)) {
    if (a.offsets[p] === undefined || bWins) a.offsets[p] = offset;
  }
  // F5.3 disabled: union — any disable wins. Once disabled anywhere, stays disabled after merge.
  for (const [p, v] of safeEntries<true>(b.disabled)) {
    if (v) a.disabled[p] = true;
  }

  a.lastAccessedAt = Math.max(a.lastAccessedAt, b.lastAccessedAt);
}

// ============================================
// Resolve for reads
// ============================================

/**
 * Resolve `(sourcePlatform, sourceSlug) → target` using node data.
 * Returns { slug, source } (same shape as legacy getTargetSlug), or null if not known.
 */
export async function resolveTarget(
  sourcePlatform: PlatformKey,
  sourceSlug: string,
  targetPlatform: PlatformKey
): Promise<{ slug: MappingValue | null; source: 'manual' | 'auto' | 'none' }> {
  const node = await nodeStore.resolveByTuple(sourcePlatform, sourceSlug);
  if (!node) return { slug: null, source: 'none' };

  // touch on read (fire-and-forget)
  nodeStore.touchLastAccessed(node.id);

  if (node.disabled[targetPlatform]) return { slug: false, source: 'manual' };

  if (node.source[targetPlatform] === 'manual') {
    const s = node.slugs[targetPlatform];
    if (typeof s === 'string' || s === false) return { slug: s, source: 'manual' };
  }

  const s = node.slugs[targetPlatform];
  if (s === false) {
    const exp = node.expires[targetPlatform] ?? 0;
    if (exp > Date.now()) return { slug: false, source: 'auto' };
    return { slug: null, source: 'none' };
  }
  if (typeof s === 'string') return { slug: s, source: 'auto' };

  return { slug: null, source: 'none' };
}
