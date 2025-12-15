import { render } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import './style.scss';

type Theme = 'default' | 'mangalib' | 'senkuro';

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

import { mangalibAPI, senkuroAPI, mangabuffAPI, readmangaAPI, inkstoryAPI } from '@/src/api';

// Platform configs for popup search
const PLATFORMS = {
  mangalib: { api: mangalibAPI, title: 'MangaLib' },
  senkuro: { api: senkuroAPI, title: 'Senkuro' },
  mangabuff: { api: mangabuffAPI, title: 'MangaBuff' },
  readmanga: { api: readmangaAPI, title: 'ReadManga' },
  inkstory: { api: inkstoryAPI, title: 'Inkstory' },
};

const LOG_LEVELS = [
  { value: 0, label: 'DEBUG' },
  { value: 1, label: 'INFO' },
  { value: 2, label: 'WARN' },
  { value: 3, label: 'ERROR' },
  { value: 999, label: 'OFF' },
];

const LOG_STORAGE_KEY = 'manga-helper:log-level';

function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GroupedResults>({});
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [theme, setTheme] = useState<Theme>('default');
  const [logLevel, setLogLevel] = useState(1); // INFO default

  // Load log level from storage
  useEffect(() => {
    browser.storage.local.get(LOG_STORAGE_KEY).then((data) => {
      const level = data[LOG_STORAGE_KEY];
      if (typeof level === 'number') {
        setLogLevel(level);
      }
    }).catch(() => {});
  }, []);

  // Detect current tab's platform for theming
  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const url = tabs[0]?.url?.toLowerCase() || '';
      if (url.includes('mangalib')) {
        setTheme('mangalib');
      } else if (url.includes('senkuro')) {
        setTheme('senkuro');
      }
    }).catch(() => {});
  }, []);

  const handleLogLevelChange = async (newLevel: number) => {
    setLogLevel(newLevel);
    await browser.storage.local.set({ [LOG_STORAGE_KEY]: newLevel });
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

  const totalResults = Object.values(results).reduce((sum, g) => sum + g.results.length, 0);

  return (
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

      <div class="footer">
        <div class="footer-row">
          <div class="log-level-selector">
            <span class="log-label">Logs:</span>
            <select
              class="log-select"
              value={logLevel}
              onChange={(e) => handleLogLevelChange(Number((e.target as HTMLSelectElement).value))}
            >
              {LOG_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div class="ad-placeholder">{/* Future ad space */}</div>
      </div>
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
