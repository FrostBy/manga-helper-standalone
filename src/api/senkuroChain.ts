/**
 * The site sends a title to the website whose client id equals the title's
 * `applicationId` — not by its labels or rating: `geonmulju-nuna` is labelled
 * `hentai` yet lives on Senkuro.
 */
export const SENKOGNITO_APPLICATION_ID = '5033164800100';

export type SenkuroChain = 'manga' | 'hentai';

/** Anything but Senkognito, absent or unknown included, stays on the main site. */
export const chainOfApplication = (applicationId: unknown): SenkuroChain =>
  String(applicationId) === SENKOGNITO_APPLICATION_ID ? 'hentai' : 'manga';
