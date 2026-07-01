// Runs in the ISOLATED content-script world.
// Manages settings (chrome.storage.sync), auto-discovers the WaniKani API
// token from the settings page, fetches + caches subjects, and injects the
// bridge + app bundle into the page context.

import { defaults } from '../src/settings.js';

export const CACHE_PREFIX = 'wkvi_subj_';

export async function getSettings() {
  const keys = Object.keys(defaults);
  const stored = await chrome.storage.sync.get(keys);
  return { ...defaults, ...stored };
}

export function buildSafeConfig(base, settings, hasApiToken = false) {
  const { apiToken: _, ...safeSettings } = settings;
  return { base, settings: safeSettings, hasApiToken };
}

// Fetch the account settings page and extract the v2 API token.
// The token is the only UUID-formatted value on that page.
export async function scrapeApiToken() {
  try {
    const resp = await fetch('/settings/account');
    if (!resp.ok) return null;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const el of doc.querySelectorAll('input, code, span')) {
      const val = el.value || el.textContent || '';
      if (uuidRe.test(val.trim())) return val.trim();
    }
    return null;
  } catch (err) {
    console.error('[wkvi] failed to scrape API token:', err);
    return null;
  }
}

export async function getApiToken() {
  // Prefer token entered manually in the options page.
  const synced = await chrome.storage.sync.get('apiToken');
  if (synced.apiToken) {
    console.log('[wkvi] using API token from options');
    return synced.apiToken;
  }

  // Fall back to previously auto-scraped token.
  const cached = await chrome.storage.local.get('wkvi_apiToken');
  if (cached.wkvi_apiToken) {
    console.log('[wkvi] using cached auto-scraped API token');
    return cached.wkvi_apiToken;
  }

  // Last resort: scrape from the settings page.
  console.log('[wkvi] attempting to scrape API token from /settings/account');
  const token = await scrapeApiToken();
  if (token) {
    await chrome.storage.local.set({ wkvi_apiToken: token });
    console.log('[wkvi] auto-discovered API token');
  } else {
    console.warn('[wkvi] could not find API token — open extension options and paste your WaniKani v2 API token');
  }
  return token || null;
}

async function fetchSubjectPage(url, apiToken) {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` }
  });
  if (!resp.ok) {
    const err = new Error(`WaniKani API error: ${resp.status}`);
    err.status = resp.status;
    // The API throttles at 60 requests/minute; a 429 carries a
    // RateLimit-Reset epoch (seconds) telling us when requests resume.
    if (resp.status === 429) {
      const reset = Number(resp.headers?.get?.('RateLimit-Reset'));
      if (reset) err.retryAfterMs = Math.max(0, reset * 1000 - Date.now());
    }
    throw err;
  }
  return resp.json();
}

// Auth/client errors — retrying won't change the outcome.
const NO_RETRY_STATUSES = new Set([401, 403, 404, 422]);
// The rate-limit window is one minute, so a reset is never further away.
const MAX_RETRY_WAIT_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const RADICALS_CACHE_KEY = 'wkvi_radicals';

// Keep only the fields the matcher needs — full subjects carry image data
// and mnemonics that would bloat chrome.storage.local.
function pruneSubject(s) {
  return {
    id: s.id,
    object: s.object,
    data: {
      slug: s.data.slug,
      characters: s.data.characters,
      meanings: s.data.meanings || [],
      auxiliary_meanings: s.data.auxiliary_meanings || [],
      readings: s.data.readings || [],
    },
  };
}

// Radical slugs are English names ("ground"), not characters, so the API's
// slugs= filter can never find a radical by its displayed character. Fetch
// the complete radical set once (~500, one page) and match locally.
async function fetchAllRadicals(apiToken) {
  const cached = await chrome.storage.local.get(RADICALS_CACHE_KEY);
  if (cached[RADICALS_CACHE_KEY]?.length) return cached[RADICALS_CACHE_KEY];

  const radicals = [];
  let url = 'https://api.wanikani.com/v2/subjects?types=radical';
  while (url) {
    const json = await fetchSubjectPage(url, apiToken);
    radicals.push(...(json.data || []).map(pruneSubject));
    url = json.pages?.next_url || null;
  }
  if (radicals.length) await chrome.storage.local.set({ [RADICALS_CACHE_KEY]: radicals });
  return radicals;
}

// The prompt is the radical's character, or for image-only radicals the
// lowercased name from the aria-label ("coat rack" vs slug "coat-rack").
function matchRadical(radical, prompt) {
  return radical.data.characters === prompt ||
         radical.data.slug === prompt ||
         radical.data.slug === prompt.replace(/\s+/g, '-');
}

// Missing token is not reported as an error here — the indicator already
// shows a dedicated no-token state.
export async function fetchSubjectsForPrompt(prompt, category, apiToken,
  { retries = 2, backoffMs = 1000, onRetry } = {}) {
  if (!apiToken) return { subjects: [], error: null };

  // An empty cache entry is treated as a miss — earlier versions cached
  // failed/empty lookups, which permanently broke the affected card.
  const cacheKey = CACHE_PREFIX + category + '_' + prompt;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]?.length) return { subjects: cached[cacheKey], error: null };

  const slug = encodeURIComponent(prompt);
  const url = `https://api.wanikani.com/v2/subjects?slugs=${slug}&types=${category}`;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let subjects;
      if (category === 'radical') {
        const radicals = await fetchAllRadicals(apiToken);
        subjects = radicals.filter(r => matchRadical(r, prompt));
      } else {
        const json = await fetchSubjectPage(url, apiToken);
        subjects = json.data || [];
      }
      if (subjects.length) await chrome.storage.local.set({ [cacheKey]: subjects });
      return { subjects, error: null };
    } catch (err) {
      lastErr = err;
      console.error(`[wkvi] subject fetch error (attempt ${attempt + 1}/${retries + 1}):`, err);
      if (NO_RETRY_STATUSES.has(err.status) || attempt === retries) break;
      onRetry?.(attempt + 1);
      // 429: wait out the rate-limit reset; otherwise exponential backoff.
      await sleep(Math.min(err.retryAfterMs ?? backoffMs * 2 ** attempt, MAX_RETRY_WAIT_MS));
    }
  }
  return { subjects: [], error: lastErr.message || 'subject fetch failed' };
}

function injectScript(src) {
  const s = document.createElement('script');
  s.src = src;
  document.documentElement.appendChild(s);
  s.remove();
}

async function main() {
  const settings = await getSettings();
  const base = chrome.runtime.getURL('');

  // Load token first so hasApiToken is accurate when the bundle reads the config.
  let apiToken = await getApiToken();
  const config = buildSafeConfig(base, settings, !!apiToken);
  document.documentElement.dataset.wkviConfig = btoa(JSON.stringify(config));

  injectScript(base + 'injected.js');
  injectScript(base + 'bundle.js');

  document.addEventListener('wkvi:subjectRequest', async (e) => {
    const { prompt, category } = e.detail;
    if (!apiToken) apiToken = await getApiToken();
    const { subjects, error } = await fetchSubjectsForPrompt(prompt, category, apiToken, {
      onRetry: () => document.dispatchEvent(new CustomEvent('wkvi:subjectRetry')),
    });
    document.dispatchEvent(new CustomEvent('wkvi:subjectData', {
      detail: { prompt, category, subjects, error }
    }));
  });

  let currentSettings = settings;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const updated = { ...currentSettings };
    for (const [k, { newValue }] of Object.entries(changes)) {
      updated[k] = newValue;
    }
    currentSettings = updated;
    const { apiToken: _, ...safeSettings } = updated;
    document.dispatchEvent(new CustomEvent('wkvi:settingsChanged', {
      detail: safeSettings
    }));
  });
}

// Auto-start only when loaded as a real content script, not during testing.
if (typeof chrome !== 'undefined' && typeof chrome.runtime?.getURL === 'function') {
  main().catch(err => console.error('[wkvi] content script error:', err));
}
