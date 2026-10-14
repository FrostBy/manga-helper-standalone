/**
 * Each site's own loading spinner, copied from its markup so our rows look
 * native. Registered per content script via setSiteLoader().
 */

/** MangaLib `svg.loader` — the site's CSS animates it. */
export const mangalibLoader = () => (
  <svg class="loader size-sm" viewBox="25 25 50 50" xmlns="http://www.w3.org/2000/svg">
    <circle class="path" fill="none" stroke-width="4" stroke-miterlimit="10" stroke-linecap="round" cx="50" cy="50" r="20" />
  </svg>
);

/** Inkstory's shadcn Spinner: lucide loader-circle + Tailwind `animate-spin`. */
export const inkstoryLoader = () => (
  <svg
    data-slot="spinner"
    role="status"
    class="lucide lucide-loader-circle animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

/** MangaBuff has no single spinner; this is its inline one, used inside buttons. */
export const mangabuffLoader = () => <span class="pack-roulette__button-spinner" />;

/** ReadManga runs Bootstrap 5 and uses its spinner-border. */
export const readmangaLoader = () => <span class="spinner-border spinner-border-sm" role="status" />;

/**
 * com-x DLE `ShowLoading` spinner. The site paints it white for its dark
 * overlay; currentColor keeps it visible on the light theme too.
 */
export const comxLoader = () => (
  <svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
    <g>
      <path fill="currentColor" d="M64,128a64,64,0,1,1,64-64A64,64,0,0,1,64,128ZM64,2.75A61.25,61.25,0,1,0,125.25,64,61.25,61.25,0,0,0,64,2.75Z" />
      <path fill="currentColor" d="M64 128a64 64 0 1 1 64-64 64 64 0 0 1-64 64zM64 2.75A61.2 61.2 0 0 0 3.34 72.4c1.28-3.52 3.9-6.32 7.5-6.86 6.55-1 11.9 2.63 13.6 8.08 3.52 11.27.5 23 15 35.25 19.47 16.46 40.34 13.54 52.84 9.46A61.25 61.25 0 0 0 64 2.75z" />
      <animateTransform attributeName="transform" type="rotate" from="0 64 64" to="360 64 64" dur="1400ms" repeatCount="indefinite" />
    </g>
  </svg>
);

/** Senkuro's button spinner: two rings drawn on pseudo-elements, fitted to the row in its styles.scss. */
export const senkuroLoader = () => <span class="button__loading" />;
