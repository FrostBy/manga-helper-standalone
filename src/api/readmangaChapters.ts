/**
 * ReadManga restarts `num` in every volume on some titles (vol 7 ch 31 of a
 * 260-chapter title) and gives extras arbitrary numbers (2265 after ch 228), so
 * totals and progress are positions in the chapter list, not chapter numbers.
 * `num` stays as the site stores it (×10) — the progress API speaks the same.
 */
export interface ChapterRow {
  vol: number;
  num: number;
}

/**
 * `rows` newest first, as the page lists them. The bookmark lands on the first
 * row not newer than it, as on the site itself — a removed or re-uploaded
 * chapter shouldn't zero the progress.
 */
export function readingStats(
  rows: ChapterRow[],
  bookmark: { vol: number; num: number } | null
): { chapter: number; lastChapterRead: number } {
  const index = bookmark
    ? rows.findIndex((r) => r.vol < bookmark.vol || (r.vol === bookmark.vol && r.num <= bookmark.num))
    : -1;
  return { chapter: rows.length, lastChapterRead: index === -1 ? 0 : rows.length - index };
}
