/** Manga-chan writes a title as "Original (Russian)"; either half may be what another site calls it. */
export function splitTitle(full: string): string[] {
  const match = full.trim().match(/^(.*\S)\s*\(([^()]+)\)$/);
  return match ? [match[1].trim(), match[2].trim()] : [full.trim()].filter(Boolean);
}
