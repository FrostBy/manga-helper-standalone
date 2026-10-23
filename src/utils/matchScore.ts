/**
 * Whether a name-matching search hit is the page's title, judged by evidence
 * other than names. Weights are tuned on real links; the cases that set them
 * are asserted in matchScore.check.ts — change a weight, rerun them.
 */

export interface TitleIds {
  mal?: string;
  al?: string;
  /** MangaUpdates slug as in its URLs (base36), not the numeric id. */
  mu?: string;
  baka?: string;
}

export interface TitleProfile {
  year?: number;
  authors: string[];
  ids: TitleIds;
  /** MangaBaka series of `ids`; absent when not resolved. */
  series?: number[];
  /**
   * MangaBaka's "alternative" series: other editions, but remakes too (Black
   * Haze 2012 ↔ 2025) — related, not the same work.
   */
  related?: number[];
}

/** At or below this a candidate is another work. */
export const REJECT_AT = -2;

/** A page that links two series of one kind (related titles) gives neither. */
export function idsInLinks(text: string): TitleIds {
  const one = (pattern: RegExp) => {
    const found = new Set([...text.matchAll(pattern)].map((match) => match[1]));
    return found.size === 1 ? [...found][0] : undefined;
  };
  return {
    mu: one(/mangaupdates\.com\/series\/([0-9a-z]+)/g),
    mal: one(/myanimelist\.net\/manga\/(\d+)/g),
    al: one(/anilist\.co\/manga\/(\d+)/g),
    baka: one(/mangabaka\.(?:org|dev)\/(?:[a-z]+\/)?(\d+)/g),
  };
}

export function yearIn(text: string | number | null | undefined): number | undefined {
  const match = String(text ?? '').match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  return match ? Number(match[1]) : undefined;
}

const ID_KINDS = ['mal', 'al', 'mu', 'baka'] as const;

function idEvidence(a: TitleProfile, b: TitleProfile): number {
  if (a.series?.length && b.series?.length) {
    const shares = (x?: number[], y?: number[]) => !!x?.some((id) => y?.includes(id));
    if (shares(a.series, b.series)) return 5;
    return shares(a.series, b.related) || shares(a.related, b.series) ? 2 : -5;
  }
  // Without MangaBaka a differing raw ID may be another edition's entry (ReadManga's
  // Overgeared links Temppal), so only a match counts.
  for (const kind of ID_KINDS) {
    const [x, y] = [a.ids[kind], b.ids[kind]];
    if (x && y && x === y) return 5;
  }
  return 0;
}

/**
 * Russian sites often give the source novel's or the translation's year, so a
 * couple of years off says nothing and a few years off is only a hint. A wide
 * gap outweighs matching authors: a remake has the same author (Black Haze
 * 2012 / 2025) and must lose to a candidate with no evidence at all.
 */
function yearEvidence(a: TitleProfile, b: TitleProfile): number {
  if (!a.year || !b.year) return 0;
  const gap = Math.abs(a.year - b.year);
  return gap <= 1 ? 1 : gap === 2 ? 0 : gap < 5 ? -1 : -3;
}

type Script = 'latin' | 'cyrillic';

function scriptOf(name: string): Script | null {
  if (/[а-яё]/i.test(name)) return 'cyrillic';
  return /[a-z]/i.test(name) ? 'latin' : null;
}

const squash = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}]/gu, '');

const SOUND_ALIKE: Record<string, string> = { k: 'g', p: 'b', t: 'd', l: 'r', к: 'г', п: 'б', т: 'д', л: 'р' };

/** Romanizations of one name differ mostly in vowels and voicing: Jipery / Jiperi, Shuuichi / Shuichi. */
function skeleton(s: string): string {
  return s
    .replace(/(.)\1+/g, '$1')
    .replace(/[aeiouyаеиоуыэюяй]/g, '')
    .replace(/./g, (c) => SOUND_ALIKE[c] ?? c)
    .replace(/(.)\1+/g, '$1');
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** Short names leave a skeleton of two or three letters, which half of all names share: those match only exactly. */
function close(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  if (shorter.length >= 5 && (a.includes(b) || b.includes(a))) return true;
  const [x, y] = [skeleton(a), skeleton(b)];
  const length = Math.min(x.length, y.length);
  if (length < 4) return false;
  if (x === y) return true;
  return length >= 6 && levenshtein(x, y) <= Math.floor(Math.max(x.length, y.length) * 0.2);
}

/** A studio signs dozens of works, so sharing one says nothing about the title. */
const STUDIO = /\b(studios?|team|media|comics?|entertainment|productions?|works|webtoons?|animation)\b/i;

/**
 * Whole name in its own and in sorted word order (Ma Wei / Wei Ma). Never a
 * single word: Kazuki Takahashi and Kazuki Nakashima share one.
 */
function forms(name: string): string[] {
  const words = name.split(/[\s,.·・()_-]+/).map(squash).filter(Boolean);
  // Sang-Hyeok Lee / Lee Sanghyuk: the given name is one word with or without its hyphen.
  const spaced = name.split(/[\s,·・()_]+/).map(squash).filter(Boolean);
  return [squash(name), [...words].sort().join(''), [...spaced].sort().join('')].filter(Boolean);
}

export function sameAuthor(a: string, b: string): boolean {
  const fb = forms(b);
  return forms(a).some((x) => fb.some((y) => close(x, y)));
}

/**
 * `undefined` when the lists share no script — Сигэно Сюити and Shuuichi
 * Shigeno can't be compared. One script agreeing is enough: the other may
 * differ only by romanization.
 */
export function authorsAgree(a: string[], b: string[]): boolean | undefined {
  let compared = false;
  for (const script of ['latin', 'cyrillic'] as const) {
    const x = a.filter((n) => scriptOf(n) === script && !STUDIO.test(n));
    const y = b.filter((n) => scriptOf(n) === script && !STUDIO.test(n));
    if (!x.length || !y.length) continue;
    if (x.some((n) => y.some((m) => sameAuthor(n, m)))) return true;
    compared = true;
  }
  return compared ? false : undefined;
}

/** Pen names make a mismatch weak evidence; a match is strong. */
function authorEvidence(a: TitleProfile, b: TitleProfile): number {
  const agree = authorsAgree(a.authors, b.authors);
  return agree === undefined ? 0 : agree ? 2 : -1;
}

export function scoreCandidate(page: TitleProfile, candidate: TitleProfile): number {
  return idEvidence(page, candidate) + yearEvidence(page, candidate) + authorEvidence(page, candidate);
}
