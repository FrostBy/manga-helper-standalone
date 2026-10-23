// Run: pnpm test
import assert from 'node:assert/strict';
import { normalizeTitle, titlesMatch, uniqueTitles, chapterPosition } from './manga.ts';

assert.deepEqual(uniqueTitles(['Как выжить в Академии', 'как выжить в академии!', 'How to Survive']), [
  'Как выжить в Академии',
  'How to Survive',
]);
// Titles the direct search already tried must not cost another request.
assert.deepEqual(uniqueTitles(['How to Survive', 'Extra'], new Set([normalizeTitle('how to survive')])), ['Extra']);
assert.deepEqual(uniqueTitles(['!!!', '']), []);

assert.ok(titlesMatch(['Ёлка'], ['елка']));
assert.ok(titlesMatch(['Solo Leveling: Ragnarok'], ['solo leveling ragnarok']));
assert.ok(titlesMatch(['The Extra’s Academy'], ["The Extra's Academy"]));
assert.ok(titlesMatch(['Как  выжить в академии'], ['Как выжить в академии']));

assert.ok(!titlesMatch(['Как выжить'], ['Как выжить в академии']));
// Symbol-only names normalize to '' — they must not match each other.
assert.ok(!titlesMatch(['???'], ['!!!']));
assert.ok(!titlesMatch([null, undefined, ''], ['anything']));

const list = ['/c/3', '/c/2', '/c/1'];
assert.equal(chapterPosition(list, '/c/1'), 1);
assert.equal(chapterPosition(list, '/c/3'), 3);
assert.equal(chapterPosition(list, '/c/9'), 0);

console.log('titlesMatch: ok');
