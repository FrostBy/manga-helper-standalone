/**
 * Safe URL parsing for getSlugFromURL.
 * Validates protocol (http/https only) and hostname against a whitelist, then
 * extracts slug from pathname via platform-specific regex.
 *
 * Prevents `javascript:`/`data:` / arbitrary-host slug strings from being stored
 * and later used as `href` after `link()` formatting.
 */

export function parseSlugFromUrl(
  url: string,
  allowedHostnames: string[],
  pathRegex: RegExp
): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase();
    const allowed = allowedHostnames.some(
      (h) => host === h.toLowerCase() || host.endsWith('.' + h.toLowerCase())
    );
    if (!allowed) return null;
    const match = u.pathname.match(pathRegex);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
