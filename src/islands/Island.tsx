import { useEffect, useState, useRef } from 'preact/hooks';
import { storage } from '@wxt-dev/storage';
import { initConfig, getAdsForSlots, type AdResult, type AdsConfig, type CacheEntry, type StorageAdapter } from 'extension-ads';
import { getGeoProfile } from '../utils/geoAdapter';

// Fallback config from dependency (bundled at build time)
import fallbackConfig from 'extension-ads-config/ads.json';

// Remote config URL (GitHub Pages)
const REMOTE_CONFIG_URL = 'https://frostby.github.io/extension-ads-config/ads.json';

// Typed storage item for ads cache
const adsCacheItem = storage.defineItem<CacheEntry | null>('local:ads-config-cache', {
  fallback: null,
});

// Storage adapter for library
const storageAdapter: StorageAdapter = {
  get: () => adsCacheItem.getValue(),
  set: (value) => adsCacheItem.setValue(value),
};

// Fetcher via background script (bypasses CORS)
const fetcher = async (): Promise<AdsConfig> => {
  const response = await browser.runtime.sendMessage({ type: 'fetch', url: REMOTE_CONFIG_URL });
  if (response.error) throw new Error(response.error);
  return response.data as AdsConfig;
};

// Load optional local config via import.meta.glob (handles missing file gracefully)
const localConfigModules = import.meta.glob<{ default: AdsConfig }>('../../ads.local.json', { eager: true });
const localConfig = Object.values(localConfigModules)[0]?.default;

// Init promise
let initPromise: Promise<AdsConfig> | null = null;

function ensureInit() {
  if (initPromise) return initPromise;

  initPromise = initConfig({
    fallback: fallbackConfig as AdsConfig,
    local: localConfig,
    fetcher,
    storage: storageAdapter,
    cacheTTL: 60 * 60 * 1000, // 1 hour
  });

  return initPromise;
}

/**
 * Hook to load ads for multiple slots without duplicate advertisers
 */
export function useAds(slots: string[], forceInDev = false, refreshKey = 0): { ads: Record<string, AdResult>; loading: boolean } {
  const skipAds = import.meta.env.DEV && !forceInDev;
  const [ads, setAds] = useState<Record<string, AdResult>>({});
  const [loading, setLoading] = useState(!skipAds);

  useEffect(() => {
    // No ads in dev mode unless forced
    if (skipAds) return;

    (async () => {
      try {
        await ensureInit();
        const profile = await getGeoProfile();

        const results = getAdsForSlots(slots, {
          country: profile.countries[0]?.code,
          language: profile.signals.language,
          platform: profile.device.platform,
          browser: profile.device.browser,
        });

        setAds(results);
      } catch {
        const emptyResults: Record<string, AdResult> = {};
        for (const slot of slots) {
          emptyResults[slot] = { html: null, fallback: null };
        }
        setAds(emptyResults);
      } finally {
        setLoading(false);
      }
    })();
  }, [slots.join(','), skipAds, refreshKey]);

  return { ads, loading };
}

interface IslandProps {
  slot: string;
  class?: string;
  ad?: AdResult;
}

export function Island({ slot, class: className, ad: providedAd }: IslandProps) {
  const [ad, setAd] = useState<AdResult | null>(providedAd || null);
  const [loading, setLoading] = useState(!providedAd);
  const [hidden, setHidden] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // If ad is provided externally, use it
  useEffect(() => {
    if (providedAd) {
      setAd(providedAd);
      setLoading(false);
    }
  }, [providedAd]);

  // Detect 1px images (ad blocker replacement) and hide slot
  useEffect(() => {
    if (!containerRef.current || hidden) return;

    const img = containerRef.current.querySelector('img');
    if (!img) return;

    const checkSize = () => {
      if (img.naturalWidth <= 1 || img.naturalHeight <= 1) {
        setHidden(true);
      }
    };

    if (img.complete) {
      checkSize();
    } else {
      img.addEventListener('load', checkSize);
      return () => img.removeEventListener('load', checkSize);
    }
  }, [ad, hidden]);

  if (loading || hidden) return null;

  // No ad and no fallback - hide
  if (!ad?.html && !ad?.fallback) return null;

  // Fallback
  if (ad.fallback) {
    return (
      <div ref={containerRef} class={className}>
        <a href={ad.fallback.link} target="_blank" rel="nofollow noopener">
          <img src={ad.fallback.image} alt="" />
        </a>
      </div>
    );
  }

  // Ad HTML - inject directly, let browser load images
  return (
    <div
      ref={containerRef}
      class={className}
      dangerouslySetInnerHTML={{ __html: ad.html! }}
    />
  );
}
