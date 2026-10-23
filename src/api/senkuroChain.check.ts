// Run: pnpm test
import assert from 'node:assert/strict';
import { chainOfApplication } from './senkuroChain.ts';

assert.equal(chainOfApplication('5033164800100'), 'hentai');
assert.equal(chainOfApplication(5033164800100), 'hentai');
assert.equal(chainOfApplication('4026531840100'), 'manga');
assert.equal(chainOfApplication(undefined), 'manga');
assert.equal(chainOfApplication(null), 'manga');
// Hub, Shiruho or a website added later: the main site carries most titles.
assert.equal(chainOfApplication('1006632962658'), 'manga');
