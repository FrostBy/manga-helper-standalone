interface ChapterStatsProps {
  total: number;
  read: number;
  hasMore?: boolean;
  className?: string;
}

export function ChapterStats({ total, read, hasMore, className }: ChapterStatsProps) {
  const classes = ['chapter-stats', hasMore && 'has-more', className].filter(Boolean).join(' ');

  return (
    <span class={classes}>
      {total} <small>[{read}]</small>
    </span>
  );
}
