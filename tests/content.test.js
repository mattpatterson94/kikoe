import { getSettings, fetchSubjectsForPrompt, buildSafeConfig, CACHE_PREFIX } from '../extension/content.js';
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
  // No runtime.getURL here — prevents auto-start of main() on import.
  runtime: {},
};

// Always provide a fetch spy so not.toHaveBeenCalled() assertions work.
const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal('chrome', chromeMock);
  vi.stubGlobal('fetch', fetchMock);
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

// ── fetchSubjectsForPrompt ────────────────────────────────────────────────────

const fakeSubjects = [{ id: 440, object: 'kanji', data: { slug: '下' } }];

describe('fetchSubjectsForPrompt', () => {
  test('returns [] when apiToken is empty without calling fetch', async () => {
    const result = await fetchSubjectsForPrompt('下', 'kanji', '');
    expect(result).toStrictEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns cached subjects without calling fetch', async () => {
    const cacheKey = CACHE_PREFIX + 'kanji_下';
    localStore[cacheKey] = fakeSubjects;

    const result = await fetchSubjectsForPrompt('下', 'kanji', 'token-123');
    expect(result).toStrictEqual(fakeSubjects);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('fetches from WaniKani API on cache miss and stores result', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: fakeSubjects }),
    });

    const result = await fetchSubjectsForPrompt('下', 'kanji', 'token-abc');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.wanikani.com/v2/subjects?slugs=%E4%B8%8B&types=kanji',
      { headers: { Authorization: 'Bearer token-abc' } }
    );
    expect(result).toStrictEqual(fakeSubjects);

    const cacheKey = CACHE_PREFIX + 'kanji_下';
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ [cacheKey]: fakeSubjects });
  });

  test('returns [] and logs error when API responds with non-ok status', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await fetchSubjectsForPrompt('下', 'kanji', 'bad-token');
    expect(result).toStrictEqual([]);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  test('URL-encodes non-ASCII prompt characters', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    await fetchSubjectsForPrompt('語', 'vocabulary', 'tok');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('%E8%AA%9E'),
      expect.any(Object)
    );
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

  test('preserves all non-sensitive settings', () => {
    const config = buildSafeConfig('chrome-extension://id/', { ...defaults, apiToken: 'secret', lightning: true });
    expect(config.settings.lightning).toBe(true);
    expect(config.settings.transcript).toBe(defaults.transcript);
  });
});
