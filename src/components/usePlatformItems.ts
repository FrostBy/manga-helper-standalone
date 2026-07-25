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
  disabled: boolean;          // manual-false OR auto-false — affects sorting / "- [-]" stats
  manuallyDisabled: boolean;  // only manual-false — affects refresh button availability
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
  const offsets = useMappingsStore((s) => s.offsets);
  const disabledMap = useMappingsStore((s) => s.disabled);

  const openModal = useMangaStore((s) => s.openModal);
  const freeChapters = useMangaStore((s) => s.freeChapters);

  if (!currentPlatform) return null;

  const platforms = PlatformRegistry.getOthers(currentPlatform as PlatformKey);

  const isDisabledKey = (key: PlatformKey): boolean => {
    if (disabledMap[key]) return true;
    const slug = manualLinks[key] ?? autoLinks[key];
    return slug === false;
  };

  const getDisplay = (key: PlatformKey): { chapter: number; read: number } => {
    const off = offsets[key] ?? 0;
    const rawChapter = cachedResults[key]?.chapter ?? 0;
    const rawRead = cachedResults[key]?.lastChapterRead ?? 0;
    return { chapter: rawChapter + off, read: rawRead + off };
  };

  const sorted = Array.from(platforms.entries()).sort(([keyA], [keyB]) => {
    const disA = isDisabledKey(keyA);
    const disB = isDisabledKey(keyB);
    if (disA !== disB) return disA ? 1 : -1;
    const a = getDisplay(keyA);
    const b = getDisplay(keyB);
    if (b.chapter !== a.chapter) return b.chapter - a.chapter;
    return b.read - a.read;
  });

  return sorted.map(([key, api]) => {
    const manualValue = manualLinks[key];
    const targetSlug = manualValue ?? autoLinks[key];
    const isLoading = loadingPlatforms.has(key);
    const hasMapping = typeof targetSlug === 'string';
    const manuallyDisabled = disabledMap[key] === true;
    const disabled = manuallyDisabled || targetSlug === false;
    const url = hasMapping ? api.link(targetSlug) : `https://${api.config.domain}`;
    const modalUrl = hasMapping ? api.link(targetSlug) : '';
    const { chapter, read: lastChapterRead } = getDisplay(key);

    return {
      key,
      api,
      url,
      modalUrl,
      chapter,
      lastChapterRead,
      isLoading,
      found: hasMapping,
      disabled,
      manuallyDisabled,
      hasMore: chapter > freeChapters,
      onRefresh: () => onRefresh(key),
      onEdit: () => openModal(key, modalUrl),
    };
  });
}
