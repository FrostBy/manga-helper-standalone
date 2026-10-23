// Run: pnpm test
import assert from 'node:assert/strict';
import { readingStats, type ChapterRow } from './readmangaChapters.ts';

const row = (vol: number, num: number): ChapterRow => ({ vol, num: num * 10 });

// Extra numbered 2265 on top of chapter 228 (Black Haze): one more chapter, not 2265.
const extra = [row(1, 2265), row(1, 228), row(1, 227), row(1, 1)];
assert.deepEqual(readingStats(extra, { vol: 1, num: 2280 }), { chapter: 4, lastChapterRead: 3 });

// Numbering restarts per volume: vol 2 ch 1 comes after vol 1 ch 2.
const volumes = [row(2, 2), row(2, 1), row(1, 2), row(1, 1)];
assert.deepEqual(readingStats(volumes, { vol: 2, num: 10 }), { chapter: 4, lastChapterRead: 3 });
assert.deepEqual(readingStats(volumes, { vol: 1, num: 20 }), { chapter: 4, lastChapterRead: 2 });

// The bookmarked chapter was removed: the progress stays at the one before it.
const gap = [row(1, 5), row(1, 3), row(1, 2)];
assert.deepEqual(readingStats(gap, { vol: 1, num: 40 }), { chapter: 3, lastChapterRead: 2 });

// No bookmark (logged out), or one older than every row.
assert.deepEqual(readingStats(gap, null), { chapter: 3, lastChapterRead: 0 });
assert.deepEqual(readingStats(gap, { vol: 1, num: 10 }), { chapter: 3, lastChapterRead: 0 });

assert.deepEqual(readingStats([], null), { chapter: 0, lastChapterRead: 0 });
