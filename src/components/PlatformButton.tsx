/**
 * Shared PlatformButton component with Tippy dropdown
 * Used by MangaLib, Senkuro, and other platforms
 */
import Tippy from '@tippyjs/react';
import { useEffect, useRef } from 'preact/hooks';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformDropdown } from './PlatformDropdown';
import { Logger } from '@/src/utils/logger';
import type { PlatformKey } from '@/src/types';

interface Props {
  /** Button content/children */
  children: preact.ComponentChildren;
  /** Tippy theme name */
  theme?: string;
  /** Dropdown placement */
  placement?: Tippy.Props['placement'];
  /** Additional button class */
  className?: string;
  /** Show dropdown on mount */
  showOnMount?: boolean;
  /** Use children as-is (no wrapper button) */
  asChild?: boolean;
  /** Callback when refresh clicked */
  onRefresh: (platformKey: PlatformKey) => void;
}

export function PlatformButton({
  children,
  theme = 'dropdown',
  placement = 'bottom-start',
  className = '',
  showOnMount = false,
  asChild = false,
  onRefresh,
}: Props) {
  const hasNewChapters = useMangaStore((s) => s.hasNewChapters);
  const tippyInstance = useRef<Tippy.Tippy | null>(null);

  // Cleanup Tippy instance on unmount
  useEffect(() => {
    Logger.debug('PlatformButton', 'useEffect mounted');
    return () => {
      Logger.debug('PlatformButton', 'useEffect cleanup', { hasInstance: !!tippyInstance.current });
      tippyInstance.current?.destroy();
      Logger.debug('PlatformButton', 'Tippy destroyed');
    };
  }, []);

  const trigger = asChild ? (
    children
  ) : (
    <button
      type="button"
      className={`platforms ${hasNewChapters ? 'new' : ''} ${className}`.trim()}
    >
      {children}
    </button>
  );

  return (
    <Tippy
      content={<PlatformDropdown onRefresh={onRefresh} />}
      trigger="click"
      interactive={true}
      arrow={false}
      placement={placement}
      animation="shift-toward"
      duration={200}
      offset={[0, 7]}
      theme={theme}
      appendTo={() => document.body}
      hideOnClick="toggle"
      showOnCreate={showOnMount}
      zIndex={10}
      onCreate={(instance: Tippy.Tippy) => {
        Logger.debug('PlatformButton', 'Tippy onCreate', { instanceId: instance.id });
        tippyInstance.current = instance;
      }}
    >
      {trigger}
    </Tippy>
  );
}
