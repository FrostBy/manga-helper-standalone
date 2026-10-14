/**
 * Platform button with native Bootstrap dropdown.
 * For sites that have Bootstrap loaded (e.g. ReadManga).
 * Both toggle attributes are needed: Bootstrap 5 reads data-bs-toggle and
 * ignores the v4 spelling, so dropping either one leaves the button dead on
 * sites running that version.
 */
import { useEffect, useRef } from 'preact/hooks';
import { t } from '@/src/utils';
import type { PlatformKey } from '@/src/types';
import { PlatformStats } from './PlatformStats';
import { usePlatformItems } from './usePlatformItems';

interface Props {
  children: preact.ComponentChildren;
  className?: string;
  onRefresh: (key: PlatformKey) => void;
}

export function BootstrapPlatformButton({ children, className = '', onRefresh }: Props) {
  const items = usePlatformItems(onRefresh);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // A DOM click, not Bootstrap's API: Bootstrap lives in the page's JS world,
  // out of the content script's reach.
  useEffect(() => buttonRef.current?.click(), []);

  return (
    <div class="dropdown">
      <button
        ref={buttonRef}
        class={className}
        type="button"
        data-toggle="dropdown"
        data-bs-toggle="dropdown"
        aria-expanded="false"
      >
        {children}
      </button>
      <div class="dropdown-menu" style={{ minWidth: '240px' }}>
        {items?.map((item) => (
          <div
            key={item.key}
            class="dropdown-item d-flex align-items-center"
            data-platform-key={item.key}
            style={{ gap: '8px' }}
          >
            <a
              href={item.url}
              class="flex-grow-1 d-flex justify-content-between"
              style={{
                opacity: item.found || item.isLoading ? 1 : 0.5,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <span>{item.api.config.title}</span>
              <PlatformStats item={item} />
            </a>
            <i
              class="fa fa-fw fa-refresh"
              title={t('refresh')}
              style={{
                cursor: 'pointer',
                opacity: item.isLoading ? 0.3 : 0.6,
                pointerEvents: item.isLoading ? 'none' : 'auto',
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!item.isLoading) item.onRefresh();
              }}
            />
            <i
              class="fa fa-fw fa-pencil"
              title={t('editLinkTooltip')}
              style={{
                cursor: 'pointer',
                opacity: item.isLoading ? 0.3 : 0.6,
                pointerEvents: item.isLoading ? 'none' : 'auto',
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!item.isLoading) item.onEdit();
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
