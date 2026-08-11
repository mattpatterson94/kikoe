// Runs in the ISOLATED content-script world.
// Manages settings (chrome.storage.sync), reads the WaniKani API token,
// fetches + caches subjects, and injects the bridge + app bundle into the
// page context.

import { defaults, encodeConfig } from '../src/settings';
import type { Settings } from '../src/settings';
import { detectSite } from '../src/site';
import { debugLog, setDebugLogging } from '../src/logger';
import type { WanikaniSubject } from '../src/wanikani';

export const CACHE_PREFIX = 'kikoe_subj_';
export const API_TOKEN_DISCOVERY_REQUESTED_KEY = 'kikoe_api_token_discovery_requested';
export const API_TOKEN_DISCOVERY_STATUS_KEY = 'kikoe_api_token_discovery_status';
export const API_TOKEN_PAGE_PATH = '/settings/personal_access_tokens';
export const API_TOKEN_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

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

export async function addCustomCorrection({ heard, intended }: Partial<{ heard: string; intended: string }>): Promise<boolean> {
  const cleanHeard = typeof heard === 'string' ? heard.trim() : '';
  const cleanIntended = typeof intended === 'string' ? intended.trim() : '';
  if (!cleanHeard || !cleanIntended) return false;

  const stored = await chrome.storage.sync.get('customCorrections') as { customCorrections?: Partial<{ heard: string; intended: string }>[] };
  const existing = Array.isArray(stored.customCorrections) ? stored.customCorrections : [];
  const next = existing.filter((pair) => {
    return pair?.heard?.trim().toLowerCase() !== cleanHeard.toLowerCase();
  });
  next.push({ heard: cleanHeard, intended: cleanIntended });
  await chrome.storage.sync.set({ customCorrections: next });
  return true;
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

  console.warn('[kikoe] could not find API token — open extension options and paste or find your WaniKani v2 API token');
  return null;
}

export function extractApiTokenFromDocument(doc: Document): string {
  const selectors = [
    'input',
    'textarea',
    'code',
    'samp',
    'kbd',
    'pre',
    '[data-token]',
    '[data-api-token]',
    '[aria-label*="token" i]',
    '[class*="token" i]',
    '[id*="token" i]',
  ].join(',');

  for (const el of doc.querySelectorAll(selectors)) {
    const values = [
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : '',
      el.getAttribute('value') || '',
      el.getAttribute('data-token') || '',
      el.getAttribute('data-api-token') || '',
      el.getAttribute('aria-label') || '',
      el.textContent || '',
    ];
    for (const value of values) {
      const match = value.match(API_TOKEN_PATTERN);
      if (match) return match[0];
    }
  }

  return '';
}

export function isApiTokenPage(location: Pick<Location, 'hostname' | 'pathname'>): boolean {
  return location.hostname === 'www.wanikani.com' && location.pathname === API_TOKEN_PAGE_PATH;
}

export async function maybeCaptureApiTokenFromPage(
  doc: Document = document,
  location: Pick<Location, 'hostname' | 'pathname'> = window.location,
): Promise<void> {
  if (!isApiTokenPage(location)) return;

  const stored = await chrome.storage.local.get(API_TOKEN_DISCOVERY_REQUESTED_KEY) as Record<string, boolean | undefined>;
  if (!stored[API_TOKEN_DISCOVERY_REQUESTED_KEY]) return;

  const token = extractApiTokenFromDocument(doc);
  if (!token) {
    await chrome.storage.local.set({
      [API_TOKEN_DISCOVERY_STATUS_KEY]: 'not_found',
    });
    return;
  }

  await chrome.storage.sync.set({ apiToken: token });
  await chrome.storage.local.set({
    [API_TOKEN_DISCOVERY_REQUESTED_KEY]: false,
    [API_TOKEN_DISCOVERY_STATUS_KEY]: 'found',
  });
  chrome.runtime.sendMessage({ type: 'kikoe:openOptions' }, () => {
    void chrome.runtime.lastError;
  });
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

// Cached subjects are wrapped rather than stored as bare arrays so that a
// change to the pruned shape can invalidate everything instead of being read
// as though it were current (that shape has changed before — see the "older
// cached shapes have varied" note in src/wanikani.ts), and so entries whose
// underlying WaniKani data may have moved on can be refreshed. User synonyms
// in particular are edited on the site, not here, so a cache that never
// expires serves stale meanings indefinitely.
export const CACHE_SCHEMA_VERSION = 1;
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A self-imposed ceiling. The point is no longer the browser's 10 MB cap —
// the manifest now requests unlimitedStorage, which is what stopped writes
// failing outright — but keeping the store small enough that reads stay fast
// and an abandoned session's prefetched queue doesn't linger forever.
export const CACHE_BUDGET_BYTES = 4 * 1024 * 1024;
// Evicting exactly to the budget would re-trigger on the very next write, so
// clear extra headroom and make eviction occasional instead of constant.
const CACHE_EVICT_TO_FRACTION = 0.8;

interface SubjectCacheEntry {
  v: number;
  t: number;
  s: WanikaniSubject[];
}

export function packSubjectCacheEntry(subjects: WanikaniSubject[], now = Date.now()): SubjectCacheEntry {
  return { v: CACHE_SCHEMA_VERSION, t: now, s: subjects };
}

// Returns the cached subjects, or null when the entry can't be trusted:
// wrong or missing version (which is also how the legacy bare-array shape
// reads), expired, or empty. Empty is a miss on purpose — earlier versions
// cached failed lookups, which permanently broke the affected card.
export function readSubjectCacheEntry(raw: unknown, now = Date.now()): WanikaniSubject[] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = raw as Partial<SubjectCacheEntry>;
  if (entry.v !== CACHE_SCHEMA_VERSION) return null;
  if (typeof entry.t !== 'number' || now - entry.t > CACHE_TTL_MS) return null;
  if (!Array.isArray(entry.s) || !entry.s.length) return null;
  return entry.s;
}

// Cache reads never throw: a storage failure is a reason to do the work
// again, never a reason to fail the caller.
async function readSubjectCache(key: string): Promise<WanikaniSubject[] | null> {
  try {
    const stored = await chrome.storage.local.get(key) as Record<string, unknown>;
    return readSubjectCacheEntry(stored[key]);
  } catch (err) {
    console.error('[kikoe] subject cache read failed:', err);
    return null;
  }
}

// Writes report success instead of throwing, because the two callers want
// opposite things from a failure: the per-card path already holds the
// subjects and must return them regardless, while the prefetch path exists
// only to populate the cache and needs to know it achieved nothing so the
// batch can be retried.
async function writeSubjectCache(
  entries: Record<string, WanikaniSubject[]>,
  protect: string[] = [],
): Promise<boolean> {
  const updates: Record<string, SubjectCacheEntry> = {};
  for (const [key, subjects] of Object.entries(entries)) {
    if (subjects.length) updates[key] = packSubjectCacheEntry(subjects);
  }
  const keys = Object.keys(updates);
  if (!keys.length) return true;

  try {
    await chrome.storage.local.set(updates);
  } catch (err) {
    console.error('[kikoe] subject cache write failed:', err);
    return false;
  }
  // Eviction is housekeeping — it runs after the write has already
  // succeeded, so its own failure must not report the write as failed.
  try {
    await evictSubjectCache([...protect, ...keys]);
  } catch (err) {
    console.error('[kikoe] subject cache eviction failed:', err);
  }
  return true;
}

// Chooses which cached subject entries to drop, given everything currently
// in storage. Only CACHE_PREFIX keys are considered — the radical set is
// expensive to rebuild (a full paginated fetch) and the token-discovery
// flags aren't cache at all, so neither is ever evicted.
export function planCacheEviction(
  all: Record<string, unknown>,
  protect: string[] = [],
  budget = CACHE_BUDGET_BYTES,
): string[] {
  const protectedKeys = new Set(protect);
  const evictable: { key: string; t: number; size: number }[] = [];
  let total = 0;

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(CACHE_PREFIX)) continue;
    const size = key.length + JSON.stringify(value ?? null).length;
    total += size;
    if (protectedKeys.has(key)) continue;
    const entry = value as Partial<SubjectCacheEntry> | null;
    const t = entry && typeof entry === 'object' && typeof entry.t === 'number' ? entry.t : 0;
    evictable.push({ key, t, size });
  }

  if (total <= budget) return [];

  // Oldest write first. Not strictly LRU: tracking real access order would
  // mean a storage write on every cache *read*, which costs more than the
  // imprecision does. Prefetch writes run ahead of use, so write order
  // tracks use order closely in practice, and anything mis-evicted is one
  // API call away.
  evictable.sort((a, b) => a.t - b.t);
  const target = budget * CACHE_EVICT_TO_FRACTION;
  const doomed: string[] = [];
  for (const entry of evictable) {
    if (total <= target) break;
    doomed.push(entry.key);
    total -= entry.size;
  }
  return doomed;
}

// Enumerating the whole store is expensive, so the scan is gated behind
// getBytesInUse, which is cheap. Where neither that nor remove() is
// available, eviction simply doesn't run: the budget is housekeeping, not
// correctness, and every entry is re-fetchable.
async function evictSubjectCache(protect: string[] = []): Promise<void> {
  const local = chrome.storage.local;
  if (typeof local.getBytesInUse !== 'function' || typeof local.remove !== 'function') return;
  if (await local.getBytesInUse(null) <= CACHE_BUDGET_BYTES) return;

  const doomed = planCacheEviction(await local.get(null) as Record<string, unknown>, protect);
  if (doomed.length) {
    debugLog(`evicting ${doomed.length} cached subject entries`);
    await local.remove(doomed);
  }
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
  const cached = await readSubjectCache(RADICALS_CACHE_KEY);
  if (cached) return cached;

  const radicals: WanikaniSubject[] = [];
  let url: string | null = 'https://api.wanikani.com/v2/subjects?types=radical';
  while (url) {
    const json: SubjectCollection = await fetchSubjectPage(url, apiToken);
    radicals.push(...(json.data || []).map(pruneSubject));
    url = json.pages?.next_url || null;
  }
  // Best-effort, like every other cache write: a full paginated radical
  // fetch is expensive to repeat, but far better than reporting the card as
  // failed because the result couldn't be stored.
  await writeSubjectCache({ [RADICALS_CACHE_KEY]: radicals });
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

  const cacheKey = subjectCacheKey(category, prompt);
  const cached = await readSubjectCache(cacheKey);
  if (cached) return { subjects: cached, error: null };

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
    // Caching is an optimization, and writeSubjectCache never throws — a
    // storage failure must not cost the caller subjects the network already
    // delivered. This previously returned an error with an empty array,
    // leaving the card with no accepted answers at all.
    await writeSubjectCache({ [cacheKey]: subjects });
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
    // The storage work used to sit outside this function's error handling
    // entirely, so a failure here rejected into the caller's un-awaited
    // listener. That skipped the un-marking of the batch, which left those
    // IDs marked as requested but never cached — a permanent cold gap in
    // the queue for the rest of the session.
    const updates: Record<string, WanikaniSubject[]> = {};
    try {
      const existing = await chrome.storage.local.get([...byKey.keys()]) as Record<string, unknown>;
      for (const [key, fetched] of byKey) {
        const prior = readSubjectCacheEntry(existing[key]) ?? [];
        updates[key] = [...prior, ...fetched.filter((s) => !prior.some((p) => p.id === s.id))];
      }
    } catch (err) {
      console.error('[kikoe] prefetch could not read existing cache entries:', err);
      for (const [key, fetched] of byKey) updates[key] = fetched;
    }
    // Unlike the per-card path, prefetching exists *only* to populate the
    // cache — a failed write means this batch accomplished nothing, so
    // report it and let the caller un-mark the IDs for a later retry.
    if (!await writeSubjectCache(updates)) {
      return { fetchedCount: 0, error: 'subject cache write failed' };
    }
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

  if (isApiTokenPage(window.location)) {
    await maybeCaptureApiTokenFromPage();
    return;
  }

  const settings = await getSettings();
  setDebugLogging(settings.debug);
  const base = chrome.runtime.getURL('');

  // The API token (and subject fetching) is WaniKani-only — BunPro's accepted
  // answers live in the page DOM, so it never needs a token.
  // Load the token first so hasApiToken is accurate when the bundle reads the config.
  let apiToken = site === 'wanikani' ? await getApiToken() : null;
  const hasApiToken = site === 'wanikani' ? !!apiToken : true;
  const config = buildSafeConfig(base, settings, hasApiToken);
  document.documentElement.dataset.kikoeConfig = encodeConfig(config);

  injectScript(base + 'injected.js');
  injectScript(base + 'bundle.js');

  // The app (page world) can't reach extension APIs — forward its request to
  // the background script, the only context that can open extension pages/tabs.
  document.addEventListener('kikoe:openOptions', () => {
    chrome.runtime.sendMessage({ type: 'kikoe:openOptions' });
  });
  document.addEventListener('kikoe:openApiTokenPage', () => {
    chrome.runtime.sendMessage({ type: 'kikoe:openApiTokenPage' });
  });

  // The one-time help-discovery hint was shown — persist the flag so it
  // never reappears (the page world can't write chrome.storage itself).
  document.addEventListener('kikoe:helpHintSeen', () => {
    chrome.storage.sync.set({ help_hint_shown: true });
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
      // Anything that escapes here strands the batch permanently, since the
      // un-marking below is what lets a later card change retry it. The
      // catch is belt-and-braces alongside prefetchSubjects' own handling.
      try {
        if (!apiToken) apiToken = await getApiToken();
        const { error } = await prefetchSubjects(batch, apiToken);
        if (error) {
          batch.forEach((id) => requestedPrefetchIds.delete(id));
          console.error('[kikoe] prefetch failed:', error);
        }
      } catch (err) {
        batch.forEach((id) => requestedPrefetchIds.delete(id));
        console.error('[kikoe] prefetch failed:', err);
      }
    });
  }

  document.addEventListener('kikoe:addCorrection', async (e) => {
    try {
      await addCustomCorrection((e as CustomEvent<Partial<{ heard: string; intended: string }>>).detail || {});
    } catch (err) {
      console.error('[kikoe] failed to save correction:', err);
    }
  });

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
