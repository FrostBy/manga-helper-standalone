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
