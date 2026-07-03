// Runs in the ISOLATED content-script world.
// Manages settings (chrome.storage.sync), reads the WaniKani API token
// entered on the options page, fetches + caches subjects, and injects the
// bridge + app bundle into the page context.

import { defaults } from '../src/settings';
import type { Settings } from '../src/settings';
import { detectSite } from '../src/site';
import { debugLog, setDebugLogging } from '../src/logger';
import type { WanikaniSubject } from '../src/wanikani';

export const CACHE_PREFIX = 'kikoe_subj_';

// Stored settings may carry the manually-entered API token alongside the
// Settings shape; buildSafeConfig strips it before anything reaches the page.
type StoredSettings = Settings & { apiToken?: string };

interface SafeConfig {
  base: string;
  settings: Omit<StoredSettings, 'apiToken'>;
  hasApiToken: boolean;
}

// WaniKani API errors carry the HTTP status (and, for 429s, how long to wait).
interface ApiError extends Error {
  status?: number;
  retryAfterMs?: number;
}

interface RetryOptions {
  retries?: number;
  backoffMs?: number;
  onRetry?: (attempt: number) => void;
}

// WaniKani API v2 collection response, narrowed to the fields we read.
interface SubjectCollection {
  data?: WanikaniSubject[];
  pages?: { next_url?: string | null };
}

export async function getSettings(): Promise<StoredSettings> {
  const keys = Object.keys(defaults);
  const stored = await chrome.storage.sync.get(keys);
  return { ...defaults, ...stored };
}

export function buildSafeConfig(base: string, settings: StoredSettings, hasApiToken = false): SafeConfig {
  const { apiToken: _, ...safeSettings } = settings;
  return { base, settings: safeSettings, hasApiToken };
}

export async function getApiToken(): Promise<string | null> {
  const synced = await chrome.storage.sync.get('apiToken') as { apiToken?: string };
  if (synced.apiToken) {
    debugLog('using API token from options');
    return synced.apiToken;
  }

  console.warn('[kikoe] could not find API token — open extension options and paste your WaniKani v2 API token');
  return null;
}

async function fetchSubjectPage(url: string, apiToken: string | null): Promise<SubjectCollection> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` }
  });
  if (!resp.ok) {
    const err: ApiError = new Error(`WaniKani API error: ${resp.status}`);
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Shared retry loop for WaniKani API calls: exponential backoff, except a
// 429 waits out the exact RateLimit-Reset instead of guessing.
async function withRetry<T>(fn: () => Promise<T>, { retries = 2, backoffMs = 1000, onRetry }: RetryOptions = {}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.error(`[kikoe] fetch error (attempt ${attempt + 1}/${retries + 1}):`, err);
      const { status, retryAfterMs } = err as ApiError;
      if ((status !== undefined && NO_RETRY_STATUSES.has(status)) || attempt === retries) break;
      onRetry?.(attempt + 1);
      await sleep(Math.min(retryAfterMs ?? backoffMs * 2 ** attempt, MAX_RETRY_WAIT_MS));
    }
  }
  throw lastErr;
}

// Same key format the per-card lookup uses (category as shown on the quiz
// UI, prompt as the exact on-screen text) — prefetched subjects must land
// under this key for the per-card path to hit the cache transparently.
export function subjectCacheKey(category: string, prompt: string): string {
  return CACHE_PREFIX + category + '_' + prompt;
}

// Image-only radicals display their lowercased, space-separated name instead
// of characters (see getPrompt's aria-label fallback in src/wanikani.ts).
function promptForSubject(subject: WanikaniSubject): string | null {
  return subject.data.characters || subject.data.slug?.replace(/-/g, ' ') || null;
}

export const RADICALS_CACHE_KEY = 'kikoe_radicals';

// Keep only the fields the matcher needs — full subjects carry image data
// and mnemonics that would bloat chrome.storage.local.
function pruneSubject(s: WanikaniSubject): WanikaniSubject {
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
async function fetchAllRadicals(apiToken: string | null): Promise<WanikaniSubject[]> {
  const cached = await chrome.storage.local.get(RADICALS_CACHE_KEY) as Record<string, WanikaniSubject[] | undefined>;
  if (cached[RADICALS_CACHE_KEY]?.length) return cached[RADICALS_CACHE_KEY];

  const radicals: WanikaniSubject[] = [];
  let url: string | null = 'https://api.wanikani.com/v2/subjects?types=radical';
  while (url) {
    const json: SubjectCollection = await fetchSubjectPage(url, apiToken);
    radicals.push(...(json.data || []).map(pruneSubject));
    url = json.pages?.next_url || null;
  }
  if (radicals.length) await chrome.storage.local.set({ [RADICALS_CACHE_KEY]: radicals });
  return radicals;
}

// The prompt is the radical's character, or for image-only radicals the
// lowercased name from the aria-label ("coat rack" vs slug "coat-rack").
function matchRadical(radical: WanikaniSubject, prompt: string): boolean {
  return radical.data.characters === prompt ||
         radical.data.slug === prompt ||
         radical.data.slug === prompt.replace(/\s+/g, '-');
}

// Missing token is not reported as an error here — the indicator already
// shows a dedicated no-token state.
export async function fetchSubjectsForPrompt(
  prompt: string,
  category: string,
  apiToken: string | null,
  { retries = 2, backoffMs = 1000, onRetry }: RetryOptions = {},
): Promise<{ subjects: WanikaniSubject[]; error: string | null }> {
  if (!apiToken) return { subjects: [], error: null };

  // An empty cache entry is treated as a miss — earlier versions cached
  // failed/empty lookups, which permanently broke the affected card.
  const cacheKey = subjectCacheKey(category, prompt);
  const cached = await chrome.storage.local.get(cacheKey) as Record<string, WanikaniSubject[] | undefined>;
  if (cached[cacheKey]?.length) return { subjects: cached[cacheKey], error: null };

  const slug = encodeURIComponent(prompt);
  const url = `https://api.wanikani.com/v2/subjects?slugs=${slug}&types=${category}`;

  try {
    const subjects = await withRetry(async () => {
      if (category === 'radical') {
        const radicals = await fetchAllRadicals(apiToken);
        return radicals.filter(r => matchRadical(r, prompt));
      }
      const json = await fetchSubjectPage(url, apiToken);
      return json.data || [];
    }, { retries, backoffMs, onRetry });
    if (subjects.length) await chrome.storage.local.set({ [cacheKey]: subjects });
    return { subjects, error: null };
  } catch (err) {
    return { subjects: [], error: (err as Error).message || 'subject fetch failed' };
  }
}

// How many subjects to warm per prefetch request. The page sends the full
// remaining queue on every card change; taking a bounded batch keeps the
// ids= URL short and spreads a long session's fetches across card changes
// instead of pulling everything up front — the window still advances 50 IDs
// per answered card, far ahead of the user.
export const PREFETCH_BATCH_SIZE = 50;

// Picks the next batch of not-yet-requested IDs (in queue order) and marks
// them in `requested`. On fetch failure the caller un-marks them so a
// transient error doesn't leave a permanent cold gap in the queue.
export function takeNextPrefetchBatch(
  subjectIds: number[] | null | undefined,
  requested: Set<number>,
  batchSize = PREFETCH_BATCH_SIZE,
): number[] {
  const batch: number[] = [];
  for (const id of subjectIds || []) {
    if (requested.has(id)) continue;
    requested.add(id);
    batch.push(id);
    if (batch.length >= batchSize) break;
  }
  return batch;
}

// Warm the cache for a batch of upcoming subject IDs (from the session
// queue) in a single request, storing each under the same category+prompt
// key the per-card path looks up later. Subjects that fail to resolve a
// prompt (shouldn't happen for real subjects) are skipped, not errored.
export async function prefetchSubjects(
  subjectIds: number[] | null | undefined,
  apiToken: string | null,
  { retries = 2, backoffMs = 1000, onRetry }: RetryOptions = {},
): Promise<{ fetchedCount: number; error: string | null }> {
  if (!apiToken || !subjectIds?.length) return { fetchedCount: 0, error: null };

  const url = `https://api.wanikani.com/v2/subjects?ids=${subjectIds.join(',')}`;

  let subjects: WanikaniSubject[];
  try {
    subjects = await withRetry(
      () => fetchSubjectPage(url, apiToken).then((json) => json.data || []),
      { retries, backoffMs, onRetry }
    );
  } catch (err) {
    return { fetchedCount: 0, error: (err as Error).message || 'prefetch failed' };
  }

  const byKey = new Map<string, WanikaniSubject[]>();
  for (const subject of subjects) {
    const prompt = promptForSubject(subject);
    if (!prompt) continue;
    const key = subjectCacheKey(subject.object, prompt);
    const group = byKey.get(key);
    if (group) {
      group.push(pruneSubject(subject));
    } else {
      byKey.set(key, [pruneSubject(subject)]);
    }
  }

  if (byKey.size) {
    const existing = await chrome.storage.local.get([...byKey.keys()]) as Record<string, WanikaniSubject[] | undefined>;
    const updates: Record<string, WanikaniSubject[]> = {};
    for (const [key, fetched] of byKey) {
      const prior: WanikaniSubject[] = existing[key] || [];
      updates[key] = [...prior, ...fetched.filter((s) => !prior.some((p) => p.id === s.id))];
    }
    await chrome.storage.local.set(updates);
  }

  return { fetchedCount: subjects.length, error: null };
}

function injectScript(src: string): void {
  const s = document.createElement('script');
  s.src = src;
  document.documentElement.appendChild(s);
  s.remove();
}

async function main(): Promise<void> {
  const site = detectSite(window.location.hostname);
  if (!site) return;

  const settings = await getSettings();
  setDebugLogging(settings.debug);
  const base = chrome.runtime.getURL('');

  // The API token (and subject fetching) is WaniKani-only — BunPro's accepted
  // answers live in the page DOM, so it never needs a token.
  // Load the token first so hasApiToken is accurate when the bundle reads the config.
  let apiToken = site === 'wanikani' ? await getApiToken() : null;
  const hasApiToken = site === 'wanikani' ? !!apiToken : true;
  const config = buildSafeConfig(base, settings, hasApiToken);
  document.documentElement.dataset.kikoeConfig = btoa(JSON.stringify(config));

  injectScript(base + 'injected.js');
  injectScript(base + 'bundle.js');

  // The app (page world) can't reach extension APIs — forward its request to
  // the background script, the only context that can open the options page.
  document.addEventListener('kikoe:openOptions', () => {
    chrome.runtime.sendMessage({ type: 'kikoe:openOptions' });
  });

  if (site === 'wanikani') {
    document.addEventListener('kikoe:subjectRequest', async (e) => {
      const { prompt, category } = (e as CustomEvent<{ prompt: string; category: string }>).detail;
      if (!apiToken) apiToken = await getApiToken();
      const { subjects, error } = await fetchSubjectsForPrompt(prompt, category, apiToken, {
        onRetry: () => document.dispatchEvent(new CustomEvent('kikoe:subjectRetry')),
      });
      document.dispatchEvent(new CustomEvent('kikoe:subjectData', {
        detail: { prompt, category, subjects, error }
      }));
    });

    // Each request takes the next unrequested batch, so the warm window
    // slides forward with every card change instead of re-deriving the same
    // head of the queue. IDs are marked before the fetch (so overlapping
    // card changes grab consecutive batches) and un-marked if it fails (so
    // the next card change retries them — bounded at one batch per change).
    const requestedPrefetchIds = new Set<number>();
    document.addEventListener('kikoe:prefetchRequest', async (e) => {
      const { subjectIds } = (e as CustomEvent<{ subjectIds: number[] }>).detail;
      const batch = takeNextPrefetchBatch(subjectIds, requestedPrefetchIds);
      if (!batch.length) return;
      if (!apiToken) apiToken = await getApiToken();
      const { error } = await prefetchSubjects(batch, apiToken);
      if (error) {
        batch.forEach((id) => requestedPrefetchIds.delete(id));
        console.error('[kikoe] prefetch failed:', error);
      }
    });
  }

  let currentSettings = settings;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const updated = { ...currentSettings };
    for (const [k, { newValue }] of Object.entries(changes)) {
      (updated as Record<string, unknown>)[k] = newValue;
    }
    currentSettings = updated;
    setDebugLogging(updated.debug);
    const { apiToken: _, ...safeSettings } = updated;
    document.dispatchEvent(new CustomEvent('kikoe:settingsChanged', {
      detail: safeSettings
    }));
  });
}

// Auto-start only when loaded as a real content script, not during testing.
if (typeof chrome !== 'undefined' && typeof chrome.runtime?.getURL === 'function') {
  main().catch(err => console.error('[kikoe] content script error:', err));
}
