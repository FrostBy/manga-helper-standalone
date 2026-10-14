/**
 * Loading indicator in our dropdown rows is the host site's own spinner, so it
 * looks native there; each content script registers its site's markup at start.
 * The wrapper pins the size: site CSS sizes these elements for page-level
 * loaders (MangaLib's `.loader` is 40px), which blew up every row.
 */
import type { ComponentChildren } from 'preact';

let renderSiteLoader: () => ComponentChildren = () => '…';

export function setSiteLoader(render: () => ComponentChildren): void {
  renderSiteLoader = render;
}

export function SiteLoader() {
  return <span class="mh-site-loader">{renderSiteLoader()}</span>;
}
