/**
 * Platform key validation — guards against prototype pollution and garbage keys
 * in stored data (user's legacy storage, sync corruption, future renames).
 */
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import type { PlatformKey } from '@/src/types';

const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);

/** Type guard: v is a registered platform key (not __proto__ etc). */
export function isPlatformKey(v: unknown): v is PlatformKey {
  if (typeof v !== 'string') return false;
  if (BLOCKED.has(v)) return false;
  return PlatformRegistry.getKeys().includes(v as PlatformKey);
}

/** Iterate entries, skipping non-PlatformKey keys and undefined values. */
export function* safeEntries<V>(
  obj: Partial<Record<PlatformKey, V>> | undefined | null
): Generator<[PlatformKey, V]> {
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) {
    if (!isPlatformKey(k)) continue;
    if (v === undefined) continue;
    yield [k, v as V];
  }
}

/** Create a prototype-less record (defense against pollution via index writes). */
export function emptyRecord<V>(): Record<string, V> {
  return Object.create(null) as Record<string, V>;
}
