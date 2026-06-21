// Runs in the ISOLATED content-script world.
// Manages settings (chrome.storage.sync) and WaniKani API subject fetching,
// then injects the bridge + app bundle into the page context.

import { defaults } from '../src/settings.js';

export const CACHE_PREFIX = 'wkvi_subj_';

export async function getSettings() {
  const keys = Object.keys(defaults);
  const stored = await chrome.storage.sync.get(keys);
  return { ...defaults, ...stored };
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

export function buildSafeConfig(base, settings) {
  const { apiToken: _, ...safeSettings } = settings;
  return { base, settings: safeSettings };
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

  const config = buildSafeConfig(base, settings);
  document.documentElement.dataset.wkviConfig = btoa(JSON.stringify(config));

  injectScript(base + 'injected.js');
  injectScript(base + 'bundle.js');

  document.addEventListener('wkvi:subjectRequest', async (e) => {
    const { prompt, category } = e.detail;
    const apiToken = (await chrome.storage.sync.get('apiToken')).apiToken || '';
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
