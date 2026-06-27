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
  if (!resp.ok) throw new Error(`WaniKani API error: ${resp.status}`);
  return resp.json();
}

export async function fetchSubjectsForPrompt(prompt, category, apiToken) {
  if (!apiToken) return [];

  const cacheKey = CACHE_PREFIX + category + '_' + prompt;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) return cached[cacheKey];

  try {
    const slug = encodeURIComponent(prompt);
    const url = `https://api.wanikani.com/v2/subjects?slugs=${slug}&types=${category}`;
    const json = await fetchSubjectPage(url, apiToken);
    const subjects = json.data || [];
    await chrome.storage.local.set({ [cacheKey]: subjects });
    return subjects;
  } catch (err) {
    console.error('[wkvi] subject fetch error:', err);
    return [];
  }
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
    const subjects = await fetchSubjectsForPrompt(prompt, category, apiToken);
    document.dispatchEvent(new CustomEvent('wkvi:subjectData', {
      detail: { prompt, category, subjects }
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
