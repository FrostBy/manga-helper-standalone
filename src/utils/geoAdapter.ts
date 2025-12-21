/**
 * Geo Profile adapter with browser storage caching
 */

import { storage } from '@wxt-dev/storage';
import { getProfile, ipapiAdapter, UserProfile } from 'geo-profile';

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface CachedProfile {
  data: UserProfile;
  expiresAt: number;
}

// Typed storage item for geo profile cache
const geoProfileCache = storage.defineItem<CachedProfile | null>('local:geo-profile-cache', {
  fallback: null,
});

/**
 * Get user profile with caching
 * @param fetchIp - whether to fetch IP data from external API
 */
export async function getGeoProfile(fetchIp = true): Promise<UserProfile> {
  if (fetchIp) {
    const cached = await geoProfileCache.getValue();
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const profile = await getProfile(fetchIp ? { ipAdapter: ipapiAdapter } : {});

  if (fetchIp) {
    await geoProfileCache.setValue({ data: profile, expiresAt: Date.now() + CACHE_TTL });
  }

  return profile;
}

export type { UserProfile } from 'geo-profile';
