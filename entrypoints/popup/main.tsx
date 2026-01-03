import { render } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import { Island, useAds } from '@/src/islands/Island';
import { logLevelItem, LogLevel } from '@/src/utils/logger';
import { mangalibAPI, senkuroAPI, mangabuffAPI, readmangaAPI, inkstoryAPI } from '@/src/api';
import './style.scss';

const AD_SLOTS = ['popup-banner', 'popup-skyscraper'];

type Theme = 'default' | 'mangalib' | 'senkuro' | 'mangabuff' | 'readmanga' | 'inkstory';

interface PopupSearchResult {
  platform: string;
  platformKey: string;
  title: string;
  url: string;
  slug: string;
  image?: string;
}

interface GroupedResults {
  [platformKey: string]: {
    title: string;
    results: PopupSearchResult[];
  };
}

// Platform configs for popup search
const PLATFORMS = {
  mangalib: { api: mangalibAPI, title: 'MangaLib' },
  senkuro: { api: senkuroAPI, title: 'Senkuro' },
  mangabuff: { api: mangabuffAPI, title: 'MangaBuff' },
  readmanga: { api: readmangaAPI, title: 'ReadManga' },
  inkstory: { api: inkstoryAPI, title: 'Inkstory' },
};

const LOG_LEVELS = [
  { value: LogLevel.DEBUG, label: 'DEBUG' },
  { value: LogLevel.INFO, label: 'INFO' },
  { value: LogLevel.WARN, label: 'WARN' },
  { value: LogLevel.ERROR, label: 'ERROR' },
  { value: LogLevel.NONE, label: 'OFF' },
];

function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GroupedResults>({});
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [theme, setTheme] = useState<Theme>('default');
  const [logLevel, setLogLevel] = useState<LogLevel>(LogLevel.INFO);
  const [adKey, setAdKey] = useState(0);
  const [showAdsInDev, setShowAdsInDev] = useState(false);

  // Load ads with deduplication
  const { ads } = useAds(AD_SLOTS, showAdsInDev, adKey);

  // Load log level from storage
  useEffect(() => {
    logLevelItem.getValue().then(setLogLevel).catch(() => {});
  }, []);

  // Detect current tab's platform for theming
  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const url = tabs[0]?.url?.toLowerCase() || '';
      if (url.includes('mangalib')) {
        setTheme('mangalib');
      } else if (url.includes('senkuro')) {
        setTheme('senkuro');
      } else if (url.includes('mangabuff')) {
        setTheme('mangabuff');
      } else if (url.includes('readmanga') || url.includes('mintmanga') || url.includes('zazaza.me')) {
        setTheme('readmanga');
      } else if (url.includes('inkstory') || url.includes('manga.ovh')) {
        setTheme('inkstory');
      }
    }).catch(() => {});
  }, []);

  const handleLogLevelChange = async (newLevel: LogLevel) => {
    setLogLevel(newLevel);
    await logLevelItem.setValue(newLevel);
    // Notify active tab to update log level
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, { type: 'setLogLevel', level: newLevel }).catch(() => {});
      }
    } catch {}
  };

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    const grouped: GroupedResults = {};

    // Search all platforms in parallel using API methods
    const searches = Object.entries(PLATFORMS).map(async ([key, { api, title }]) => {
      try {
        const results = await api.searchByQuery(query.trim());
        if (results.length > 0) {
          grouped[key] = {
            title,
            results: results.map((r) => ({
              platform: title,
              platformKey: key,
              title: r.title,
              url: api.link(r.slug),
              slug: r.slug,
              image: r.image,
            })),
          };
        }
      } catch (e) {
        console.error(`Search failed for ${key}:`, e);
      }
    });

    await Promise.all(searches);
    setResults(grouped);
    setLoading(false);
  }, [query]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const openLink = (url: string) => {
    browser.tabs.create({ url });
  };

  const handleExportStorage = async () => {
    const data = await browser.storage.local.get(null);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manga-helper-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportStorage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await browser.storage.local.clear();
        await browser.storage.local.set(data);
        alert('Storage restored!');
      } catch {
        alert('Failed to import storage');
      }
    };
    input.click();
  };

  const totalResults = Object.values(results).reduce((sum, g) => sum + g.results.length, 0);

  return (
    <div class="popup-wrapper">
      <div class={`popup theme-${theme}`}>
        <div class="search-box">
        <input
          type="text"
          class="search-input"
          placeholder={browser.i18n.getMessage('searchPlaceholder') || 'Search manga...'}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={handleKeyDown}
          autofocus
        />
        <button class="search-btn" onClick={handleSearch} disabled={loading}>
          {loading ? <Spinner /> : <SearchIcon />}
        </button>
      </div>

      <div class="results">
        {loading && <div class="loading">{browser.i18n.getMessage('searching') || 'Searching...'}</div>}

        {!loading && searched && totalResults === 0 && (
          <div class="no-results">{browser.i18n.getMessage('noResults') || 'No results found'}</div>
        )}

        {!loading &&
          Object.entries(results).map(([key, group]) => (
            <div class="platform-group" key={key}>
              <div class="platform-header">{group.title}</div>
              <div class="platform-results">
                {group.results.map((result, i) => (
                  <div class="result-item" key={i} onClick={() => openLink(result.url)}>
                    {result.image && <img class="result-thumb" src={result.image} alt="" />}
                    <span class="result-title">{result.title}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>

      {import.meta.env.DEV && (
        <div class="toolbar">
          <div class="toolbar-group">
            <span class="toolbar-label">Logs:</span>
            <select
              class="toolbar-select"
              value={logLevel}
              onChange={(e) => handleLogLevelChange(Number((e.target as HTMLSelectElement).value) as LogLevel)}
            >
              {LOG_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </div>
          <div class="toolbar-group">
            <button class="toolbar-btn" onClick={handleExportStorage} title="Export storage">↓</button>
            <button class="toolbar-btn" onClick={handleImportStorage} title="Import storage">↑</button>
            <button class="toolbar-btn" onClick={() => { setShowAdsInDev(true); setAdKey(k => k + 1); }} title="Randomize ads">🎲</button>
          </div>
        </div>
      )}
      {(ads['popup-banner']?.html || ads['popup-banner']?.fallback) && (
        <div class="footer">
          <Island slot="popup-banner" class="ad-placeholder" ad={ads['popup-banner']} />
        </div>
      )}
      </div>
      <Island slot="popup-skyscraper" class="ad-skyscraper" ad={ads['popup-skyscraper']} />
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg class="spinner" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="32" stroke-linecap="round" />
    </svg>
  );
}

render(<App />, document.getElementById('app')!);
