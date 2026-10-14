import type { Manga } from '@/src/types';

/**
 * Extract searchable titles from a Manga object.
 * Used wherever we need to match manga across platforms via title strings
 * (transitive bridge resolution, fetchMangaData fallback titles).
 */
export function collectTitles(manga: Manga | null | undefined): string[] {
  if (!manga) return [];
  const titles: string[] = [];
  if (manga.name) titles.push(manga.name);
  if (manga.rus_name) titles.push(manga.rus_name);
  if (manga.eng_name) titles.push(manga.eng_name);
  if (Array.isArray(manga.otherNames)) titles.push(...manga.otherNames);
  return titles;
}

/**
 * Sites spell the same title with different case, ё/е, quotes, dashes and
 * spacing — exact comparison made real matches look like "not found".
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Every title is a separate search request, so near-duplicates ("Академии" /
 * "академии") and titles already tried elsewhere are dropped up front.
 */
export function uniqueTitles(
  titles: readonly string[],
  alreadyTried: ReadonlySet<string> = new Set()
): string[] {
  const seen = new Set(alreadyTried);
  return titles.filter((title) => {
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function titlesMatch(
  candidates: ReadonlyArray<string | null | undefined>,
  titles: readonly string[]
): boolean {
  const wanted = new Set(titles.map(normalizeTitle).filter(Boolean));
  return candidates.some((name) => !!name && wanted.has(normalizeTitle(name)));
}
