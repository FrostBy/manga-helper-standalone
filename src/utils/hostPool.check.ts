// Run: pnpm test
import assert from 'node:assert/strict';
import { orderHosts, isUnavailable } from './hostPool.ts';

const pool = { id: 'p', hosts: ['https://a', 'https://b', 'https://c'] };
const now = 1000;

assert.deepEqual(orderHosts(pool, undefined, now), ['https://a', 'https://b', 'https://c']);
assert.deepEqual(orderHosts(pool, { host: 'https://c', expires: now + 1 }, now), ['https://c', 'https://a', 'https://b']);
// Expired: back to the primary, which may work again (VPN switched off).
assert.deepEqual(orderHosts(pool, { host: 'https://c', expires: now }, now), ['https://a', 'https://b', 'https://c']);
// A host dropped from the pool since it was remembered.
assert.deepEqual(orderHosts(pool, { host: 'https://gone', expires: now + 1 }, now), ['https://a', 'https://b', 'https://c']);

for (const status of [undefined, 403, 408, 429, 451, 500, 503]) assert.ok(isUnavailable(status), String(status));
for (const status of [200, 400, 401, 404, 405]) assert.ok(!isUnavailable(status), String(status));
