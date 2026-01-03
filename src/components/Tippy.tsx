/**
 * Lightweight Tippy wrapper for Preact
 * Replaces @tippyjs/react with direct tippy.js usage
 */
import tippy, { Instance, Props } from 'tippy.js';
import { useRef, useEffect } from 'preact/hooks';
import { cloneElement, render } from 'preact';

interface TippyProps extends Partial<Omit<Props, 'content'>> {
  children: preact.VNode;
  content: preact.ComponentChildren;
  /** Import tippy.css base styles (default: false) */
  injectCSS?: boolean;
}

// CSS loaded once on first injectCSS=true usage
let cssInjected = false;

export function Tippy({ children, content, injectCSS = false, ...props }: TippyProps) {
  const triggerRef = useRef<Element>(null);
  const instanceRef = useRef<Instance | null>(null);

  // Inject CSS if needed
  useEffect(() => {
    if (injectCSS && !cssInjected) {
      import('tippy.js/dist/tippy.css');
      cssInjected = true;
    }
  }, [injectCSS]);

  // Create tippy instance
  useEffect(() => {
    if (!triggerRef.current) return;

    // Create container for Preact content
    const container = document.createElement('div');
    render(<>{content}</>, container);

    instanceRef.current = tippy(triggerRef.current, {
      content: container,
      allowHTML: true,
      ...props,
    });

    return () => {
      instanceRef.current?.destroy();
      render(null, container);
    };
  }, []);

  return cloneElement(children, { ref: triggerRef });
}
