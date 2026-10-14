import type { ComponentChildren } from 'preact';

interface ChapterStatsProps {
  total: number;
  read: number;
  hasMore?: boolean;
  className?: string;
  children?: ComponentChildren;
}

export function ChapterStats({ total, read, hasMore, className, children }: ChapterStatsProps) {
  const classes = ['chapter-stats', hasMore && 'has-more', className].filter(Boolean).join(' ');

  return (
    <span class={classes}>
      {total} <small>[{read}]</small>
      {children}
    </span>
  );
}
