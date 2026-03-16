import type { PlatformConfig } from '@/src/types';

/** Returns mirror domain if we're on one, otherwise the primary domain */
export function resolveActiveDomain(config: PlatformConfig): string {
  const hostname = location.hostname;
  return config.mirrors?.find(d => hostname.includes(d)) ?? config.domain;
}

/** Checks if we're currently on a mirror domain */
export function isMirror(config: PlatformConfig): boolean {
  return config.mirrors?.some(d => location.hostname.includes(d)) ?? false;
}
