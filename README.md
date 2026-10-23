<p align="center">
  <img src="icon.png" alt="Manga Helper" width="128" height="128">
</p>

# Manga Helper

[![GitHub release](https://img.shields.io/github/v/release/FrostBy/manga-helper-standalone)](https://github.com/FrostBy/manga-helper-standalone/releases/latest)

[🇷🇺 Русский](README.ru.md) | **English**

Cross-platform manga tracker browser extension. Track your reading progress across multiple manga sites and quickly find where more chapters are available.

## Features

- **Cross-platform tracking** — See chapter counts from other sites while browsing your favorite manga platform
- **Reading progress sync** — Shows your reading progress from each platform
- **Auto-search** — Automatically finds the same manga on other platforms by title matching; refresh re-checks an automatic link and replaces or drops a wrong match
- **Smarter matching** — When several titles share a name, candidates are compared by external IDs (MyAnimeList, AniList, MangaUpdates through [MangaBaka](https://mangabaka.org)), release year and authors: a namesake or a remake from another year isn't linked, the right edition wins
- **Dead links heal** — An automatic link whose title was deleted or re-uploaded on its site is searched again on page load instead of staying broken; manual links are never touched
- **Manual linking** — Manually link manga across platforms when auto-search doesn't find a match
- **Mark as unavailable** — Explicitly mark a platform as unavailable (e.g. blocked by the copyright holder); it moves to the bottom of the list and is skipped by auto-refresh
- **Chapter comparison** — Highlights platforms that have more chapters available; licensed MangaLib titles count all chapters, not just the open preview
- **Load status** — A platform that failed to load is marked with ⚠ instead of showing 0; numbers past their cache lifetime are dimmed until refreshed
- **Sister sites** — Each platform covers its sister catalogs: HentaiLib, Senkognito, MintManga and SeiManga (ReadManga), PureManga (Inkstory); a title's link, counts and progress come from the site it lives on, a pasted link tells the site
- **Mirrors** — If a site or its API is blocked, MangaLib, Senkuro, ReadManga and MintManga requests and links switch to a working mirror; refresh starts from the main host again
- **Native look** — The button, dropdown and loading spinner follow each site's own style; the dropdown opens when a manga page loads
- **Popup search** — Search manga across all platforms from the extension popup with cover thumbnails; results are grouped by site (MangaLib / HentaiLib, Senkuro / Senkognito, ReadManga / MintManga / SeiManga, Inkstory / PureManga)
- **Debug logging** — Configurable log level (DEBUG/INFO/WARN/ERROR/OFF) in popup settings
- **Caching** — Results are cached to minimize API requests

## Supported Platforms

| Platform | Domain | Status |
|----------|--------|--------|
| MangaLib + HentaiLib | mangalib.me, mangalib.org, hentailib.me | ✅ Full support |
| Senkuro + Senkognito | senkuro.com, senkuro.me, senkognito.com | ✅ Full support |
| MangaBuff | mangabuff.ru | ✅ Full support |
| ReadManga + MintManga + SeiManga | zazaza.me, readmanga.me, mintmanga.one, mintmanga.com, seimanga.me | ✅ Full support |
| Inkstory + PureManga | inkstory.net, puremanga.me | ✅ Full support |
| Com-x | com-x.life | ✅ Full support |
| AllHentai | allhen.online, allhentai.ru | ✅ Full support |
| Remanga | remanga.org | ✅ Full support (progress needs sign-in) |
| Manga-chan | manga-chan.me | ✅ Full support (progress saved while reading) |
| Mangahub | mangahub.ru | ✅ Full support (progress saved while reading) |
| MangaPoisk | mangapoisk.me, mangapoisk.ru | ✅ Full support (progress saved while reading) |

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/FrostBy/manga-helper-standalone.git
   cd manga-helper-standalone
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the extension:
   ```bash
   pnpm build
   ```

4. Load in browser:
   - **Chrome**: Go to `chrome://extensions/`, enable Developer mode, click "Load unpacked", select `.output/chrome-mv3`
   - **Firefox**: Go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", select any file in `.output/firefox-mv2`

### Development

```bash
# Start dev server with hot reload
pnpm dev

# Firefox
pnpm dev:firefox

# Type checking
pnpm typecheck

# Self-checks
pnpm test

# Set the version to today's CalVer (YYYY.M.D.N, N = releases already tagged today)
pnpm bump
```

## Usage

1. Navigate to a manga page on any supported platform
2. The "Other sites" dropdown opens next to the bookmark/favorite button; the button toggles it
3. Each row shows the platform's chapter count and, in brackets, your progress there
4. A highlighted count means more chapters are available on that platform; ⚠ means its data couldn't be loaded
5. Click the refresh icon to re-check a platform, or the edit icon to link a manga manually if auto-search didn't find it

## Tech Stack

- [WXT](https://wxt.dev/) — Next-gen web extension framework
- [Preact](https://preactjs.com/) — Fast 3kB React alternative
- [Zustand](https://zustand.docs.pmnd.rs/) — Lightweight state management
- [Tippy.js](https://atomiks.github.io/tippyjs/) — Tooltip/popover library
- TypeScript, Sass

