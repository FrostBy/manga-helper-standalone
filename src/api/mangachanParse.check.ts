// Run: pnpm test
import assert from 'node:assert/strict';
import { splitTitle } from './mangachanParse.ts';

assert.deepEqual(splitTitle('MF Ghost (MF Призрак)'), ['MF Ghost', 'MF Призрак']);
assert.deepEqual(splitTitle('Black Butler (Тёмный дворецкий)'), ['Black Butler', 'Тёмный дворецкий']);
// Brackets inside the original stay with it; only the trailing pair is the Russian name.
assert.deepEqual(splitTitle('Re:Zero (Season 2) (Жизнь с нуля)'), ['Re:Zero (Season 2)', 'Жизнь с нуля']);
assert.deepEqual(splitTitle('Берсерк'), ['Берсерк']);
assert.deepEqual(splitTitle('  '), []);

console.log('mangachanParse: ok');
