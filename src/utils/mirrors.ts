/**
 * Shared, cross-tab memory for host pools: which host of a pool answered last,
 * and which chain (site of a platform — manga, hentai) a title belongs to.
 * Loaded on import because `link()` reads it synchronously while rendering.
 */
import { storage } from '@wxt-dev/storage';
import { createLock } from './lock';
import { orderHosts, type HostChoice, type HostPool } from './hostPool';
import type { PlatformKey } from '@/src/types';

const CHOICES_KEY = 'local:hostChoices';
const CHAINS_KEY = 'local:titleChains';
/** Long enough to skip a dead primary on every load, short enough to drift back to it. */
const CHOICE_TTL_MS = 60 * 60 * 1000;
/** Not stored: a title without an entry is on the platform's main site. */
export const MAIN_CHAIN = 'manga';

type Choices = Record<string, HostChoice>;
type Chains = Partial<Record<PlatformKey, Record<string, string>>>;

let choices: Choices = {};
let chains: Chains = {};
const listeners = new Set<() => void>();
// Parallel writes within one tab race just like writes from two tabs.
const writeLock = createLock('mirrors');

const ready = Promise.all([storage.getItem<Choices>(CHOICES_KEY), storage.getItem<Chains>(CHAINS_KEY)])
  .then(([storedChoices, storedChains]) => {
    choices = storedChoices ?? {};
    chains = storedChains ?? {};
  })
  .catch(() => {});
storage.watch<Choices>(CHOICES_KEY, (value) => {
  choices = value ?? {};
  listeners.forEach((notify) => notify());
});
storage.watch<Chains>(CHAINS_KEY, (value) => {
  chains = value ?? {};
  listeners.forEach((notify) => notify());
});

/** `link()` reads this memory outside any store, so rows re-render through this. */
export function subscribeMirrors(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export async function hostsFor(pool: HostPool): Promise<string[]> {
  await ready;
  return orderHosts(pool, choices[pool.id], Date.now());
}

/**
 * The last host that answered, expired or not: a cached row renders without a
 * request, and an expired choice would link it back to a blocked primary.
 */
export function currentHost(pool: HostPool): string {
  const host = choices[pool.id]?.host;
  return host && pool.hosts.includes(host) ? host : pool.hosts[0];
}

export function hasFreshChoice(pool: HostPool): boolean {
  const choice = choices[pool.id];
  return !!choice && choice.expires > Date.now() && pool.hosts.includes(choice.host);
}

export function rememberHost(pool: HostPool, host: string): Promise<void> {
  if (choices[pool.id]?.host === host && hasFreshChoice(pool)) return Promise.resolve();
  return writeLock(async () => {
    const all = (await storage.getItem<Choices>(CHOICES_KEY)) ?? {};
    all[pool.id] = { host, expires: Date.now() + CHOICE_TTL_MS };
    choices = all;
    await storage.setItem(CHOICES_KEY, all);
  });
}

/** Refresh starts from the primary again: the user may have switched the VPN off. */
export function forgetHosts(pools: readonly HostPool[]): Promise<void> {
  return writeLock(async () => {
    const all = (await storage.getItem<Choices>(CHOICES_KEY)) ?? {};
    for (const pool of pools) delete all[pool.id];
    choices = all;
    await storage.setItem(CHOICES_KEY, all);
  });
}

export function titleChain(platform: PlatformKey, slug: string): string {
  return chains[platform]?.[slug] ?? MAIN_CHAIN;
}

export async function setTitleChain(platform: PlatformKey, slug: string, chain: string): Promise<void> {
  await ready;
  if (titleChain(platform, slug) === chain) return;
  await writeLock(async () => {
    const all = (await storage.getItem<Chains>(CHAINS_KEY)) ?? {};
    const platformChains = (all[platform] ??= {});
    if (chain === MAIN_CHAIN) delete platformChains[slug];
    else platformChains[slug] = chain;
    chains = all;
    await storage.setItem(CHAINS_KEY, all);
  });
}
