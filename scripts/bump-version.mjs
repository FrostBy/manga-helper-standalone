/**
 * Set package.json version to today's CalVer YYYY.M.D.N, N = releases already tagged today.
 * Run: pnpm bump
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const PACKAGE_JSON = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

const now = new Date();
const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()];

// Old tags are zero-padded (v2026.09.21) and a day's first release had no 4th part, so compare numbers.
const releasedToday = execSync('git tag -l "v*"', { encoding: 'utf8' })
  .split('\n')
  .map((tag) => tag.trim().match(/^v(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/))
  .filter((match) => match && today.every((part, i) => Number(match[i + 1]) === part))
  .map((match) => Number(match[4] ?? 0));

const n = releasedToday.length > 0 ? Math.max(...releasedToday) + 1 : 0;
const version = [...today, n].join('.');

const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
pkg.version = version;
writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2) + '\n');
console.log(version);
