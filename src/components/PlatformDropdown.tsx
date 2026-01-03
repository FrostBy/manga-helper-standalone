import { useMappingsStore } from '@/src/stores/mappings';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformRegistry } from '@/src/platforms/PlatformRegistry';
import { t } from '@/src/utils';
import type { PlatformKey } from '@/src/types';
import type { BasePlatformAPI } from '@/src/api/base';
import { ChapterStats } from './ChapterStats';

interface Props {
  onRefresh: (platformKey: PlatformKey) => void;
}

export function PlatformDropdown({ onRefresh }: Props) {
  const currentPlatform = useMappingsStore((s) => s.currentPlatform);
  const cachedResults = useMappingsStore((s) => s.cachedResults);
  const loadingPlatforms = useMappingsStore((s) => s.loadingPlatforms);
  const manualLinks = useMappingsStore((s) => s.manualLinks);
  const autoLinks = useMappingsStore((s) => s.autoLinks);

  const openModal = useMangaStore((s) => s.openModal);
  const freeChapters = useMangaStore((s) => s.freeChapters);

  if (!currentPlatform) return null;

  const platforms = PlatformRegistry.getOthers(currentPlatform as PlatformKey);

  // Sort platforms by chapter count (descending)
  const sortedPlatforms = Array.from(platforms.entries()).sort(([keyA], [keyB]) => {
    const chapterA = cachedResults[keyA]?.chapter ?? 0;
    const chapterB = cachedResults[keyB]?.chapter ?? 0;
    return chapterB - chapterA;
  });

  return (
    <div class="dropdown-menu mh-dropdown">
      <div class="platforms-dropdown">
        <div class="menu">
          <div class="menu-list scrollable">
            {sortedPlatforms.map(([key, api]) => {
              const targetSlug = manualLinks[key] ?? autoLinks[key];
              const cached = cachedResults[key];
              const isLoading = loadingPlatforms.has(key);
              const hasMapping = targetSlug && typeof targetSlug === 'string';
              const url = hasMapping ? api.link(targetSlug) : `https://${api.config.domain}`;
              const modalUrl = hasMapping ? api.link(targetSlug) : '';

              const platformChapter = cached?.chapter ?? 0;
              const hasMore = platformChapter > freeChapters;

              return (
                <PlatformItem
                  key={key}
                  platformKey={key}
                  platform={api}
                  url={url}
                  chapter={platformChapter}
                  lastChapterRead={cached?.lastChapterRead ?? 0}
                  isLoading={isLoading}
                  found={typeof targetSlug === 'string'}
                  hasMore={hasMore}
                  onRefresh={() => onRefresh(key)}
                  onEdit={() => openModal(key, modalUrl)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface PlatformItemProps {
  platformKey: PlatformKey;
  platform: BasePlatformAPI;
  url: string;
  chapter: number;
  lastChapterRead: number;
  isLoading: boolean;
  found: boolean;
  hasMore: boolean;
  onRefresh: () => void;
  onEdit: () => void;
}

function PlatformItem({
  platformKey,
  platform,
  url,
  chapter,
  lastChapterRead,
  isLoading,
  found,
  hasMore,
  onRefresh,
  onEdit,
}: PlatformItemProps) {
  return (
    <div class="menu-item" data-platform-key={platformKey}>
      <div class="menu-item__text">
        <a href={url} style={{ opacity: found || isLoading ? 1 : 0.6 }}>
          <span class="platform-name">{platform.config.title}</span>
          {isLoading ? (
            <span class="platform-stats"><InlineLoader /></span>
          ) : (
            <ChapterStats total={chapter} read={lastChapterRead} hasMore={hasMore} className="platform-stats" />
          )}
        </a>
      </div>
      <span
        class="refresh-link"
        title={t('refresh')}
        style={{ pointerEvents: isLoading ? 'none' : 'auto', opacity: isLoading ? 0.3 : undefined }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isLoading) onRefresh();
        }}
      >
        <RefreshIcon />
      </span>
      <span
        class="edit-link"
        title={t('editLinkTooltip')}
        style={{ pointerEvents: isLoading ? 'none' : 'auto', opacity: isLoading ? 0.3 : undefined }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isLoading) onEdit();
        }}
      >
        <EditIcon />
      </span>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg class="svg-inline--fa fa-refresh menu-item__icon" viewBox="0 0 512 512">
      <path fill="currentColor" d="M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160H352c-17.7 0-32 14.3-32 32s14.3 32 32 32h112c17.7 0 32-14.3 32-32V80c0-17.7-14.3-32-32-32s-32 14.3-32 32v35.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-.3 1.2-.6 2.5-.8 3.8c-.3 1.7-.4 3.4-.4 5.1V432c0 17.7 14.3 32 32 32s32-14.3 32-32v-35.1l17.6 17.5c87.5 87.4 229.3 87.4 316.7 0c24.4-24.4 42.1-53.1 52.9-83.8c5.9-16.7-2.9-34.9-19.5-40.8s-34.9 2.9-40.8 19.5c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0l-.1-.1L125.6 352H160c17.7 0 32-14.3 32-32s-14.3-32-32-32H48.4c-1.6 0-3.2.1-4.8.3s-3.1.5-4.6 1z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg class="svg-inline--fa fa-pencil menu-item__icon" viewBox="0 0 512 512">
      <path fill="currentColor" d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0L362.3 51.7l97.9 97.9 30.1-30.1c21.9-21.9 21.9-57.3 0-79.2L471.6 21.7zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5L437.7 172.3 339.7 74.3 172.4 241.7zM96 64C43 64 0 107 0 160v256c0 53 43 96 96 96h256c53 0 96-43 96-96v-96c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7-14.3 32-32 32H96c-17.7 0-32-14.3-32-32V160c0-17.7 14.3-32 32-32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32H96z" />
    </svg>
  );
}

function InlineLoader() {
  return (
    <span class="inline-loader">
      <svg class="loader size-sm" viewBox="25 25 50 50" xmlns="http://www.w3.org/2000/svg">
        <circle class="path" fill="none" stroke-width="4" stroke-miterlimit="10" stroke-linecap="round" cx="50" cy="50" r="20" />
      </svg>
    </span>
  );
}
