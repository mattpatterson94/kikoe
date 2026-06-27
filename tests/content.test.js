import { getSettings, buildSafeConfig, scrapeApiToken, fetchSubjectsForPrompt, CACHE_PREFIX } from '../extension/content.js';
import { defaults } from '../src/settings.js';

// ── Chrome API mock ───────────────────────────────────────────────────────────

let syncStore = {};
let localStore = {};

const chromeMock = {
  storage: {
    sync: {
      get: vi.fn(async (keys) => {
        const result = {};
        const ks = Array.isArray(keys) ? keys : [keys];
        for (const k of ks) {
          if (syncStore[k] !== undefined) result[k] = syncStore[k];
        }
        return result;
      }),
      set: vi.fn(async (obj) => { Object.assign(syncStore, obj); }),
    },
    local: {
      get: vi.fn(async (key) => {
        const k = typeof key === 'string' ? key : Object.keys(key)[0];
        return localStore[k] !== undefined ? { [k]: localStore[k] } : {};
      }),
      set: vi.fn(async (obj) => { Object.assign(localStore, obj); }),
    },
    onChanged: { addListener: vi.fn() },
  },
  runtime: {},
};

beforeAll(() => {
  vi.stubGlobal('chrome', chromeMock);
});

beforeEach(() => {
  syncStore = {};
  localStore = {};
  vi.clearAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// ── getSettings ───────────────────────────────────────────────────────────────

describe('getSettings', () => {
  test('returns defaults when storage is empty', async () => {
    const settings = await getSettings();
    expect(settings).toMatchObject(defaults);
  });

  test('overrides defaults with stored values', async () => {
    syncStore.lightning = true;
    syncStore.transcript_delay = 10;
    const settings = await getSettings();
    expect(settings.lightning).toBe(true);
    expect(settings.transcript_delay).toBe(10);
  });

  test('fills missing stored keys with defaults', async () => {
    syncStore.lightning = true;
    const settings = await getSettings();
    expect(settings.transcript).toBe(defaults.transcript);
    expect(settings.transcript_position).toBe(defaults.transcript_position);
  });
});

// ── buildSafeConfig ───────────────────────────────────────────────────────────

describe('buildSafeConfig', () => {
  test('strips apiToken from settings', () => {
    const config = buildSafeConfig('chrome-extension://id/', { ...defaults, apiToken: 'secret' });
    expect(config.settings).not.toHaveProperty('apiToken');
  });

  test('includes the extension base URL', () => {
    const config = buildSafeConfig('chrome-extension://id/', defaults);
    expect(config.base).toBe('chrome-extension://id/');
  });

  test('hasApiToken false by default', () => {
    const config = buildSafeConfig('chrome-extension://id/', defaults);
    expect(config.hasApiToken).toBe(false);
  });

  test('hasApiToken true when token present', () => {
    const config = buildSafeConfig('chrome-extension://id/', defaults, true);
    expect(config.hasApiToken).toBe(true);
  });

  test('preserves all non-sensitive settings', () => {
    const config = buildSafeConfig('chrome-extension://id/', { ...defaults, apiToken: 'secret', lightning: true });
    expect(config.settings.lightning).toBe(true);
    expect(config.settings.transcript).toBe(defaults.transcript);
  });
});

// ── scrapeApiToken ────────────────────────────────────────────────────────────

describe('scrapeApiToken', () => {
  const TOKEN = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  beforeEach(() => {
    vi.stubGlobal('DOMParser', class {
      parseFromString(html) {
        document.body.innerHTML = html;
        return document;
      }
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('extracts UUID from an input value', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      text: async () => `<input type="text" value="${TOKEN}" readonly />`,
    }));
    expect(await scrapeApiToken()).toBe(TOKEN);
  });

  test('extracts UUID from a code element', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      text: async () => `<code>${TOKEN}</code>`,
    }));
    expect(await scrapeApiToken()).toBe(TOKEN);
  });

  test('returns null when no UUID is found', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      text: async () => `<p>No token here</p>`,
    }));
    expect(await scrapeApiToken()).toBeNull();
  });

  test('returns null on non-ok response', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }));
    expect(await scrapeApiToken()).toBeNull();
  });
});

// ── fetchSubjectsForPrompt ────────────────────────────────────────────────────

describe('fetchSubjectsForPrompt', () => {
  const TOKEN = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const mockSubject = { id: 1, object: 'kanji', data: { slug: '下', characters: '下', meanings: [] } };

  test('returns [] when no apiToken provided', async () => {
    expect(await fetchSubjectsForPrompt('下', 'kanji', null)).toEqual([]);
  });

  test('fetches from API and caches result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [mockSubject] }),
    })));
    const result = await fetchSubjectsForPrompt('下', 'kanji', TOKEN);
    expect(result).toEqual([mockSubject]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('returns cached result without fetching again', async () => {
    const cacheKey = CACHE_PREFIX + 'kanji_下';
    localStore[cacheKey] = [mockSubject];
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchSubjectsForPrompt('下', 'kanji', TOKEN);
    expect(result).toEqual([mockSubject]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
