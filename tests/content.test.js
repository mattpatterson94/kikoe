import {
  getSettings,
  buildSafeConfig,
  getApiToken,
  extractApiTokenFromDocument,
  isApiTokenPage,
  maybeCaptureApiTokenFromPage,
  fetchSubjectsForPrompt,
  prefetchSubjects,
  takeNextPrefetchBatch,
  subjectCacheKey,
  addCustomCorrection,
  API_TOKEN_DISCOVERY_REQUESTED_KEY,
  API_TOKEN_DISCOVERY_STATUS_KEY,
  CACHE_PREFIX,
  RADICALS_CACHE_KEY,
} from '../extension/content';
import { defaults } from '../src/settings';

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
      get: vi.fn(async (keys) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        const result = {};
        for (const k of ks) {
          if (localStore[k] !== undefined) result[k] = localStore[k];
        }
        return result;
      }),
      set: vi.fn(async (obj) => { Object.assign(localStore, obj); }),
    },
    onChanged: { addListener: vi.fn() },
  },
  runtime: {
    lastError: undefined,
    sendMessage: vi.fn((_message, callback) => {
      if (callback) callback();
    }),
  },
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
    syncStore.turbo = true;
    const settings = await getSettings();
    expect(settings.turbo).toBe(true);
  });

  test('fills missing stored keys with defaults', async () => {
    syncStore.turbo = true;
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
    const config = buildSafeConfig('chrome-extension://id/', { ...defaults, apiToken: 'secret', turbo: true });
    expect(config.settings.turbo).toBe(true);
    expect(config.settings.transcript).toBe(defaults.transcript);
  });
});

// ── addCustomCorrection ───────────────────────────────────────────────────────

describe('addCustomCorrection', () => {
  test('appends a cleaned custom correction', async () => {
    await expect(addCustomCorrection({ heard: ' gibberish ', intended: ' さむい ' })).resolves.toBe(true);
    expect(syncStore.customCorrections).toEqual([{ heard: 'gibberish', intended: 'さむい' }]);
  });

  test('replaces an existing correction with the same heard text', async () => {
    syncStore.customCorrections = [
      { heard: 'Gibberish', intended: '古い' },
      { heard: 'other', intended: 'ほか' },
    ];

    await addCustomCorrection({ heard: 'gibberish', intended: 'さむい' });

    expect(syncStore.customCorrections).toEqual([
      { heard: 'other', intended: 'ほか' },
      { heard: 'gibberish', intended: 'さむい' },
    ]);
  });

  test('ignores blank correction data', async () => {
    await expect(addCustomCorrection({ heard: ' ', intended: 'さむい' })).resolves.toBe(false);
    expect(syncStore.customCorrections).toBeUndefined();
  });
});

// ── getApiToken ───────────────────────────────────────────────────────────────

describe('getApiToken', () => {
  const TOKEN = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  test('returns the token entered on the options page', async () => {
    syncStore.apiToken = TOKEN;
    expect(await getApiToken()).toBe(TOKEN);
  });

  test('returns null when no token is stored, without fetching WaniKani', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getApiToken()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ── API token discovery ──────────────────────────────────────────────────────

describe('API token discovery', () => {
  const TOKEN = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  test('recognizes the WaniKani personal access tokens page', () => {
    expect(isApiTokenPage({
      hostname: 'www.wanikani.com',
      pathname: '/settings/personal_access_tokens',
    })).toBe(true);
    expect(isApiTokenPage({
      hostname: 'www.wanikani.com',
      pathname: '/review/session',
    })).toBe(false);
  });

  test('extracts a token from rendered token page controls', () => {
    document.body.innerHTML = `
      <main>
        <input id="personal-access-token" value="${TOKEN}">
      </main>
    `;

    expect(extractApiTokenFromDocument(document)).toBe(TOKEN);
  });

  test('automatically saves a discovered token when discovery is pending', async () => {
    localStore[API_TOKEN_DISCOVERY_REQUESTED_KEY] = true;
    document.body.innerHTML = `<code>${TOKEN}</code>`;

    await maybeCaptureApiTokenFromPage(document, {
      hostname: 'www.wanikani.com',
      pathname: '/settings/personal_access_tokens',
    });

    expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({ apiToken: TOKEN });
    expect(syncStore.apiToken).toBe(TOKEN);
    expect(localStore[API_TOKEN_DISCOVERY_REQUESTED_KEY]).toBe(false);
    expect(localStore[API_TOKEN_DISCOVERY_STATUS_KEY]).toBe('found');
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'kikoe:openOptions' },
      expect.any(Function),
    );
  });

  test('reports when a pending discovery finds no token', async () => {
    localStore[API_TOKEN_DISCOVERY_REQUESTED_KEY] = true;
    document.body.innerHTML = '<main>No tokens yet</main>';

    await maybeCaptureApiTokenFromPage(document, {
      hostname: 'www.wanikani.com',
      pathname: '/settings/personal_access_tokens',
    });

    expect(syncStore.apiToken).toBeUndefined();
    expect(localStore[API_TOKEN_DISCOVERY_REQUESTED_KEY]).toBe(true);
    expect(localStore[API_TOKEN_DISCOVERY_STATUS_KEY]).toBe('not_found');
  });
});

// ── fetchSubjectsForPrompt ────────────────────────────────────────────────────

describe('fetchSubjectsForPrompt', () => {
  const TOKEN = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const mockSubject = { id: 1, object: 'kanji', data: { slug: '下', characters: '下', meanings: [] } };

  test('returns no subjects and no error when no apiToken provided', async () => {
    expect(await fetchSubjectsForPrompt('下', 'kanji', null))
      .toEqual({ subjects: [], error: null });
  });

  test('fetches from API and caches result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [mockSubject] }),
    })));
    const result = await fetchSubjectsForPrompt('下', 'kanji', TOKEN);
    expect(result).toEqual({ subjects: [mockSubject], error: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('returns cached result without fetching again', async () => {
    const cacheKey = CACHE_PREFIX + 'kanji_下';
    localStore[cacheKey] = [mockSubject];
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchSubjectsForPrompt('下', 'kanji', TOKEN);
    expect(result).toEqual({ subjects: [mockSubject], error: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('reports an error when the API responds with a failure status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const result = await fetchSubjectsForPrompt('下', 'kanji', TOKEN, { retries: 0 });
    expect(result.subjects).toEqual([]);
    expect(result.error).toMatch(/500/);
  });

  test('reports an error when the fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const result = await fetchSubjectsForPrompt('下', 'kanji', TOKEN, { retries: 0 });
    expect(result.subjects).toEqual([]);
    expect(result.error).toBe('Failed to fetch');
  });

  test('does not cache a failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await fetchSubjectsForPrompt('下', 'kanji', TOKEN, { retries: 0 });
    expect(localStore[CACHE_PREFIX + 'kanji_下']).toBeUndefined();
  });

  test('retries a transient failure and succeeds, reporting each retry', async () => {
    const onRetry = vi.fn();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (++calls === 1) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ data: [mockSubject] }) };
    }));
    const result = await fetchSubjectsForPrompt('下', 'kanji', TOKEN, { backoffMs: 1, onRetry });
    expect(result).toEqual({ subjects: [mockSubject], error: null });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('waits out the RateLimit-Reset before retrying a 429', async () => {
    let calls = 0;
    // Reset one epoch-second in the past → retry proceeds immediately.
    const headers = { get: (name) => name === 'RateLimit-Reset' ? String(Math.floor(Date.now() / 1000) - 1) : null };
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (++calls === 1) return { ok: false, status: 429, headers };
      return { ok: true, json: async () => ({ data: [mockSubject] }) };
    }));
    const result = await fetchSubjectsForPrompt('下', 'kanji', TOKEN, { backoffMs: 1 });
    expect(result).toEqual({ subjects: [mockSubject], error: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('does not retry auth errors', async () => {
    const onRetry = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    const result = await fetchSubjectsForPrompt('下', 'kanji', TOKEN, { backoffMs: 1, onRetry });
    expect(result.error).toMatch(/401/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  test('gives up after exhausting retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const result = await fetchSubjectsForPrompt('下', 'kanji', TOKEN, { retries: 2, backoffMs: 1 });
    expect(result.error).toMatch(/500/);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('treats a cached empty result as a miss and refetches', async () => {
    localStore[CACHE_PREFIX + 'kanji_下'] = [];
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [mockSubject] }),
    })));
    const result = await fetchSubjectsForPrompt('下', 'kanji', TOKEN);
    expect(result.subjects).toEqual([mockSubject]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('does not cache an empty API result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));
    await fetchSubjectsForPrompt('下', 'kanji', TOKEN);
    expect(localStore[CACHE_PREFIX + 'kanji_下']).toBeUndefined();
  });
});

// ── radical lookup ────────────────────────────────────────────────────────────

describe('fetchSubjectsForPrompt for radicals', () => {
  const TOKEN = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const ground = {
    id: 1, object: 'radical', url: 'https://api.wanikani.com/v2/subjects/1',
    data: {
      slug: 'ground', characters: '一',
      meanings: [{ meaning: 'Ground', accepted_answer: true }],
      created_at: '2012-02-27', level: 1, document_url: 'x', hidden_at: null,
    },
  };
  const coatRack = {
    id: 2, object: 'radical', url: 'https://api.wanikani.com/v2/subjects/2',
    data: {
      slug: 'coat-rack', characters: null,
      meanings: [{ meaning: 'Coat Rack', accepted_answer: true }],
      created_at: '2012-02-27', level: 2, document_url: 'x', hidden_at: null,
    },
  };

  function stubRadicalApi() {
    const page2 = { data: [coatRack], pages: { next_url: null } };
    const page1 = {
      data: [ground],
      pages: { next_url: 'https://api.wanikani.com/v2/subjects?types=radical&page_after_id=1' },
    };
    vi.stubGlobal('fetch', vi.fn(async (url) =>
      ({ ok: true, json: async () => (url.includes('page_after_id') ? page2 : page1) })));
  }

  test('fetches the full radical set and matches by character, not slug', async () => {
    stubRadicalApi();
    const result = await fetchSubjectsForPrompt('一', 'radical', TOKEN);
    expect(result.error).toBeNull();
    expect(result.subjects).toHaveLength(1);
    expect(result.subjects[0].data.slug).toBe('ground');
    // Follows pagination and never uses the (broken for radicals) slugs= filter.
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url] of fetch.mock.calls) expect(url).not.toContain('slugs=');
  });

  test('matches image-only radicals by their aria-label name', async () => {
    stubRadicalApi();
    const result = await fetchSubjectsForPrompt('coat rack', 'radical', TOKEN);
    expect(result.subjects).toHaveLength(1);
    expect(result.subjects[0].id).toBe(2);
  });

  test('caches the pruned radical set and reuses it for later radicals', async () => {
    stubRadicalApi();
    await fetchSubjectsForPrompt('一', 'radical', TOKEN);
    // Stored set is pruned — no bulky fields, both pages present.
    expect(localStore[RADICALS_CACHE_KEY]).toHaveLength(2);
    expect(localStore[RADICALS_CACHE_KEY][0].data.document_url).toBeUndefined();

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchSubjectsForPrompt('coat rack', 'radical', TOKEN);
    expect(result.subjects).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('reports an error when the radical fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const result = await fetchSubjectsForPrompt('一', 'radical', TOKEN, { retries: 0 });
    expect(result.subjects).toEqual([]);
    expect(result.error).toMatch(/500/);
    expect(localStore[RADICALS_CACHE_KEY]).toBeUndefined();
  });
});

// ── subjectCacheKey ───────────────────────────────────────────────────────────

describe('subjectCacheKey', () => {
  test('matches the key fetchSubjectsForPrompt caches under', async () => {
    const mockSubject = { id: 1, object: 'kanji', data: { slug: '下', characters: '下', meanings: [] } };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [mockSubject] }) })));
    await fetchSubjectsForPrompt('下', 'kanji', 'tok');
    expect(localStore[subjectCacheKey('kanji', '下')]).toEqual([mockSubject]);
  });
});

// ── prefetchSubjects ──────────────────────────────────────────────────────────

describe('prefetchSubjects', () => {
  const TOKEN = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  const kanji = {
    id: 440, object: 'kanji',
    data: { slug: '下', characters: '下', meanings: [{ meaning: 'Below', accepted_answer: true }], readings: [] },
  };
  const kanaVocab = {
    id: 900, object: 'kana_vocabulary',
    data: { slug: 'ばか', characters: 'ばか', meanings: [{ meaning: 'Idiot', accepted_answer: true }], readings: [] },
  };
  const imageRadical = {
    id: 2, object: 'radical',
    data: { slug: 'coat-rack', characters: null, meanings: [{ meaning: 'Coat Rack', accepted_answer: true }], readings: [] },
  };

  test('does nothing when there is no apiToken', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await prefetchSubjects([440], null);
    expect(result).toEqual({ fetchedCount: 0, error: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('does nothing when the id list is empty', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await prefetchSubjects([], TOKEN);
    expect(result).toEqual({ fetchedCount: 0, error: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('fetches a batch of ids in a single request', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ data: [kanji, kanaVocab] }) }));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await prefetchSubjects([440, 900], TOKEN);
    expect(result).toEqual({ fetchedCount: 2, error: null });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.wanikani.com/v2/subjects?ids=440,900');
  });

  test('caches each subject under its category+prompt key, pruned', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [kanji] }) })));
    await prefetchSubjects([440], TOKEN);
    const cached = localStore[subjectCacheKey('kanji', '下')];
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe(440);
    expect(cached[0].data.meanings).toEqual(kanji.data.meanings);
  });

  test('uses the API object type directly for kana_vocabulary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [kanaVocab] }) })));
    await prefetchSubjects([900], TOKEN);
    expect(localStore[subjectCacheKey('kana_vocabulary', 'ばか')]).toHaveLength(1);
  });

  test('falls back to the space-separated slug for image-only radicals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [imageRadical] }) })));
    await prefetchSubjects([2], TOKEN);
    expect(localStore[subjectCacheKey('radical', 'coat rack')]).toHaveLength(1);
  });

  test('merges with subjects already cached under the same key instead of clobbering', async () => {
    const otherKanji = { id: 441, object: 'kanji', data: { slug: '下2', characters: '下', meanings: [] } };
    localStore[subjectCacheKey('kanji', '下')] = [otherKanji];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [kanji] }) })));
    await prefetchSubjects([440], TOKEN);
    const cached = localStore[subjectCacheKey('kanji', '下')];
    expect(cached.map(s => s.id).sort()).toEqual([440, 441]);
  });

  test('does not duplicate a subject already present under its key', async () => {
    localStore[subjectCacheKey('kanji', '下')] = [{ id: 440, object: 'kanji', data: { slug: '下', characters: '下', meanings: [] } }];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [kanji] }) })));
    await prefetchSubjects([440], TOKEN);
    expect(localStore[subjectCacheKey('kanji', '下')]).toHaveLength(1);
  });

  test('retries a transient failure', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (++calls === 1) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ data: [kanji] }) };
    }));
    const result = await prefetchSubjects([440], TOKEN, { backoffMs: 1 });
    expect(result).toEqual({ fetchedCount: 1, error: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('reports an error and caches nothing when the batch fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const result = await prefetchSubjects([440], TOKEN, { retries: 0 });
    expect(result.fetchedCount).toBe(0);
    expect(result.error).toMatch(/500/);
    expect(localStore[subjectCacheKey('kanji', '下')]).toBeUndefined();
  });
});

// ── takeNextPrefetchBatch ─────────────────────────────────────────────────────

describe('takeNextPrefetchBatch', () => {
  test('takes the first batch and marks it as requested', () => {
    const requested = new Set();
    const batch = takeNextPrefetchBatch([1, 2, 3], requested, 2);
    expect(batch).toEqual([1, 2]);
    expect([...requested]).toEqual([1, 2]);
  });

  test('slides past already-requested ids to the next batch', () => {
    const requested = new Set([1, 2]);
    expect(takeNextPrefetchBatch([1, 2, 3, 4, 5], requested, 2)).toEqual([3, 4]);
  });

  test('advances through a queue longer than one batch across successive calls', () => {
    const queue = Array.from({ length: 120 }, (_, i) => i + 1);
    const requested = new Set();
    takeNextPrefetchBatch(queue, requested);
    takeNextPrefetchBatch(queue, requested);
    const third = takeNextPrefetchBatch(queue, requested);
    expect(third).toEqual(queue.slice(100, 120));
    expect(requested.size).toBe(120);
  });

  test('returns an empty batch once the whole queue has been requested', () => {
    const requested = new Set([1, 2, 3]);
    expect(takeNextPrefetchBatch([1, 2, 3], requested)).toEqual([]);
  });

  test('re-takes ids that were un-marked after a failed fetch', () => {
    const requested = new Set();
    const failed = takeNextPrefetchBatch([1, 2, 3, 4], requested, 2);
    failed.forEach((id) => requested.delete(id));
    expect(takeNextPrefetchBatch([1, 2, 3, 4], requested, 2)).toEqual([1, 2]);
  });

  test('handles a missing id list', () => {
    expect(takeNextPrefetchBatch(undefined, new Set())).toEqual([]);
  });
});
