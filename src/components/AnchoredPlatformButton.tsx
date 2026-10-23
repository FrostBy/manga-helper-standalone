/**
 * A site-styled trigger with the platforms dropdown under it, for sites whose
 * menus we copy by class rather than through Tippy.
 */
import type { ComponentChildren } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformDropdown } from './PlatformDropdown';
import type { PlatformKey } from '@/src/types';

interface Props {
  openOnMount: boolean;
  onRefresh: (key: PlatformKey) => void;
  menuClass: string;
  itemClass?: string;
  trigger: (state: { isOpen: boolean; toggle: () => void; hasNewChapters: boolean }) => ComponentChildren;
}

export function AnchoredPlatformButton({ openOnMount, onRefresh, menuClass, itemClass, trigger }: Props) {
  const [isOpen, setIsOpen] = useState(openOnMount);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasNewChapters = useMangaStore((s) => s.hasNewChapters);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // The edit modal opens from a row; clicking in it must not close the list under it.
      if (!rootRef.current?.contains(target) && !document.getElementById('edit-link-modal')?.contains(target)) {
        setIsOpen(false);
      }
    };
    // The edit modal handles its own Escape; closing the list under it would lose the row being edited.
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.getElementById('edit-link-modal')) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  // Anchored to the trigger, not `fixed`: the dropdown opens on load and must follow the page as it scrolls.
  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      {trigger({ isOpen, toggle: () => setIsOpen((open) => !open), hasNewChapters })}
      {isOpen && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50 }}>
          <div class={menuClass}>
            <PlatformDropdown onRefresh={onRefresh} itemClass={itemClass} />
          </div>
        </div>
      )}
    </div>
  );
}
