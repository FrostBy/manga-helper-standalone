// Run: pnpm test
import assert from 'node:assert/strict';
import { readingStats, parseBookmarkIds } from './inkstoryProgress.ts';

const ch = (id: string, branchId: string, volume: number, number: number) => ({ id, branchId, volume, number });

// API order is newest first; `number` restarts per volume, so volume 2
// chapter 1 comes after volume 1 chapter 3, and an extra 2.1 after 2.
const chapters = [
  ch('v2c1', 'a', 2, 1),
  ch('v1c3', 'a', 1, 3),
  ch('v1c2.1', 'a', 1, 2.1),
  ch('v1c2', 'a', 1, 2),
  ch('v1c1', 'a', 1, 1),
  ch('b1', 'b', 1, 1),
  ch('b2', 'b', 1, 2),
];

assert.deepEqual(readingStats(chapters, ['v2c1']), { chapter: 5, lastChapterRead: 5 });
assert.deepEqual(readingStats(chapters, ['v1c3']), { chapter: 5, lastChapterRead: 4 });
// Counted inside its own branch, not the fullest one.
assert.deepEqual(readingStats(chapters, ['b2']), { chapter: 5, lastChapterRead: 2 });
assert.deepEqual(readingStats(chapters, ['b1', 'v1c2']), { chapter: 5, lastChapterRead: 2 });
assert.deepEqual(readingStats(chapters, ['gone']), { chapter: 5, lastChapterRead: 0 });
assert.deepEqual(readingStats([], []), { chapter: 0, lastChapterRead: 0 });

const page =
  'bookmarks:$R[93]=[$R[94]={id:"6a639f2c-7109-4d02-9324-f059a37f18c8",branchId:"074582b9-cdf3-449c-bb4d-a6d1099df989",' +
  'chapterId:"3c680e7a-6266-44dd-9410-517f40244890",page:84}]';
assert.deepEqual(parseBookmarkIds(page), ['3c680e7a-6266-44dd-9410-517f40244890']);
assert.deepEqual(parseBookmarkIds('bookmarks:$R[111]=[],folderItem:null'), []);
