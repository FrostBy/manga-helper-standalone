import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import type { PlatformKey } from '@/src/types';
import type { BasePlatformAPI } from '@/src/api/base';

export interface PlatformItem {
  key: PlatformKey;
  api: BasePlatformAPI;
  url: string;
  modalUrl: string;
  chapter: number;
  lastChapterRead: number;
  isLoading: boolean;
  found: boolean;
  hasMore: boolean;
  onRefresh: () => void;
  onEdit: () => void;
}

export function usePlatformItems(
  onRefresh: (key: PlatformKey) => void
): PlatformItem[] | null {
  const currentPlatform = useMappingsStore((s) => s.currentPlatform);
  const cachedResults = useMappingsStore((s) => s.cachedResults);
  const loadingPlatforms = useMappingsStore((s) => s.loadingPlatforms);
  const manualLinks = useMappingsStore((s) => s.manualLinks);
  const autoLinks = useMappingsStore((s) => s.autoLinks);

  const openModal = useMangaStore((s) => s.openModal);
  const freeChapters = useMangaStore((s) => s.freeChapters);

  if (!currentPlatform) return null;

  const platforms = PlatformRegistry.getOthers(currentPlatform as PlatformKey);

  const sorted = Array.from(platforms.entries()).sort(([keyA], [keyB]) => {
    const chapterA = cachedResults[keyA]?.chapter ?? 0;
    const chapterB = cachedResults[keyB]?.chapter ?? 0;
    return chapterB - chapterA;
  });

  return sorted.map(([key, api]) => {
    const targetSlug = manualLinks[key] ?? autoLinks[key];
    const cached = cachedResults[key];
    const isLoading = loadingPlatforms.has(key);
    const hasMapping = targetSlug && typeof targetSlug === 'string';
    const url = hasMapping ? api.link(targetSlug) : `https://${api.config.domain}`;
    const modalUrl = hasMapping ? api.link(targetSlug) : '';
    const chapter = cached?.chapter ?? 0;

    return {
      key,
      api,
      url,
      modalUrl,
      chapter,
      lastChapterRead: cached?.lastChapterRead ?? 0,
      isLoading,
      found: typeof targetSlug === 'string',
      hasMore: chapter > freeChapters,
      onRefresh: () => onRefresh(key),
      onEdit: () => openModal(key, modalUrl),
    };
  });
}
