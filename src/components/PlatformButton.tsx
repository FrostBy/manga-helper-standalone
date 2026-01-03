/**
 * Shared PlatformButton component with Tippy dropdown
 * Used by MangaLib, Senkuro, and other platforms
 */
import { Tippy } from './Tippy';
import { useEffect, useRef } from 'preact/hooks';
import { useMangaStore } from '@/src/stores/manga';
import { PlatformDropdown } from './PlatformDropdown';
import { Logger } from '@/src/utils/logger';
import type { PlatformKey } from '@/src/types';
import type { Instance, Placement } from 'tippy.js';

interface Props {
  /** Button content/children */
  children: preact.ComponentChildren;
  /** Tippy theme name */
  theme?: string;
  /** Dropdown placement */
  placement?: Placement;
  /** Additional button class */
  className?: string;
  /** Show dropdown on mount */
  showOnMount?: boolean;
  /** Use children as-is (no wrapper button) */
  asChild?: boolean;
  /** Where to append the tippy popup ('parent' or element) */
  appendTo?: 'parent' | (() => Element);
  /** Tippy z-index */
  zIndex?: number;
  /** Tippy animation */
  animation?: string;
  /** Inject tippy.css base styles */
  injectCSS?: boolean;
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
  appendTo = () => document.body,
  zIndex = 10,
  animation = 'shift-toward',
  injectCSS = false,
  onRefresh,
}: Props) {
  const hasNewChapters = useMangaStore((s) => s.hasNewChapters);
  const tippyInstance = useRef<Instance | null>(null);

  // Cleanup Tippy instance on unmount (only if not already destroyed)
  useEffect(() => {
    return () => {
      const instance = tippyInstance.current;
      if (instance && !instance.state.isDestroyed) {
        instance.destroy();
      }
      tippyInstance.current = null;
    };
  }, []);

  const trigger = asChild ? (
    children as preact.VNode
  ) : (
    <button
      type="button"
      className={`${className} ${hasNewChapters ? 'new' : ''}`.trim()}
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
      animation={animation}
      duration={200}
      offset={[0, 7]}
      theme={theme}
      appendTo={appendTo}
      hideOnClick="toggle"
      showOnCreate={showOnMount}
      zIndex={zIndex}
      injectCSS={injectCSS}
      onCreate={(instance: Instance) => {
        Logger.debug('PlatformButton', 'Tippy onCreate', { instanceId: instance.id });
        tippyInstance.current = instance;
      }}
    >
      {trigger}
    </Tippy>
  );
}
