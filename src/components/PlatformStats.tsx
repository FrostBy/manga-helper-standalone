/**
 * A failed load is marked instead of rendering "0 [0]", which read as "no
 * chapters"; numbers past their TTL stay visible but dimmed while a refetch can
 * still replace them.
 */
import { t } from '@/src/utils';
import { ChapterStats } from './ChapterStats';
import { SiteLoader } from './SiteLoader';
import type { PlatformItem } from './usePlatformItems';

export function PlatformStats({ item }: { item: PlatformItem }) {
  if (item.isLoading) {
    return <span class="platform-stats"><SiteLoader /></span>;
  }

  if (item.disabled) {
    return <span class="platform-stats chapter-stats">- <small>[-]</small></span>;
  }

  const failedMark = item.failed && <span class="mh-failed" title={t('loadFailed')}>⚠</span>;

  if (!item.hasData) {
    return <span class="platform-stats">{failedMark}</span>;
  }

  // One element on purpose: `platform-stats` must share it with `has-more`
  // (site styles let `.has-more` lift the row's dimmed opacity; a wrapper
  // multiplied them into a muddy colour), and a sibling ⚠ became an extra flex
  // child that pushed the numbers off the right edge on com-x.
  return (
    <ChapterStats
      total={item.chapter}
      read={item.lastChapterRead}
      hasMore={item.hasMore}
      className={`platform-stats${item.stale ? ' mh-stale' : ''}`}
    >
      {failedMark}
    </ChapterStats>
  );
}
