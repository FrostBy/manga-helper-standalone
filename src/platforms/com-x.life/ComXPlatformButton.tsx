/**
 * Platform dropdown for com-x.life, built to match the site's own "Коллекция"
 * list (`.page__favs` → `.page__btn-sec` + `ul.page__fav-list`).
 *
 * The site ships no Bootstrap JS — only jQuery — so `data-toggle="dropdown"`
 * does nothing here and BootstrapPlatformButton would never open. Open/close is
 * therefore handled locally, mirroring the site's own `.d-none` toggle.
 *
 * Site classes are reused on purpose: styling then comes from com-x itself and
 * follows its light/dark themes for free.
 */
import { useState, useEffect, useRef } from 'preact/hooks';
import { t } from '@/src/utils';
import type { PlatformKey } from '@/src/types';
import { ChapterStats } from '@/src/components/ChapterStats';
import { usePlatformItems } from '@/src/components/usePlatformItems';

interface Props {
  onRefresh: (key: PlatformKey) => void;
}

export function ComXPlatformButton({ onRefresh }: Props) {
  const items = usePlatformItems(onRefresh);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Esc — same feel as the site's own list
  useEffect(() => {
    if (!open) return;

    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} class="page__favs mh-comx">
      <button
        type="button"
        class="page__btn-sec btn mh-comx-btn"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span>{t('otherSites')}</span>
        <span class={`fal fa-angle-down mh-comx-caret${open ? ' is-open' : ''}`} />
      </button>

      <ul class={`page__fav-list mh-comx-list${open ? '' : ' d-none'}`}>
        {items?.map((item) => (
          <li key={item.key} data-platform-key={item.key} class="mh-comx-item">
            <a
              href={item.url}
              class="mh-comx-link"
              style={{ opacity: item.found || item.isLoading ? 1 : 0.5 }}
            >
              <span class="platform-name">{item.api.config.title}</span>
              {item.isLoading ? (
                <span class="platform-stats">…</span>
              ) : item.disabled ? (
                <span class="platform-stats chapter-stats">- <small>[-]</small></span>
              ) : (
                <ChapterStats
                  total={item.chapter}
                  read={item.lastChapterRead}
                  hasMore={item.hasMore}
                  className="platform-stats"
                />
              )}
            </a>

            <span
              class="fal fa-sync refresh-link"
              title={t('refresh')}
              style={{
                pointerEvents: item.isLoading || item.manuallyDisabled ? 'none' : 'auto',
                opacity: item.isLoading ? 0.3 : item.manuallyDisabled ? 0.25 : undefined,
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (item.isLoading || item.manuallyDisabled) return;
                item.onRefresh();
              }}
            />
            <span
              class="fal fa-pencil edit-link"
              title={t('editLinkTooltip')}
              style={{
                pointerEvents: item.isLoading ? 'none' : 'auto',
                opacity: item.isLoading ? 0.3 : undefined,
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!item.isLoading) item.onEdit();
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
