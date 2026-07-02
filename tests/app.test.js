// app.js self-executes on import (reads the page-context config, detects the
// site, and starts the listener once a review/lesson/quiz page is detected).
// Each test re-imports it fresh with vi.resetModules() so the top-level setup
// runs again against that test's DOM/location/globals.

function stubReviewPage() {
  vi.stubGlobal('location', { hostname: 'www.wanikani.com', href: 'https://www.wanikani.com/subjects/review' });
}

function stampConfig(overrides = {}) {
  const config = {
    settings: {},
    base: '',
    hasApiToken: false,
    ...overrides,
  };
  document.documentElement.dataset.kikoeConfig = Buffer.from(JSON.stringify(config)).toString('base64');
}

function stubDictionaryFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
}

async function importApp() {
  await import('../src/app.js');
  // init() awaits loadDictionary (a mocked fetch) before starting the
  // listener; let that microtask chain settle before assertions run.
  await vi.waitFor(() => {
    if (!document.getElementById('kikoe-idle-label')) throw new Error('idle indicator not shown yet');
  });
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-kikoe-config');
  stubReviewPage();
  stubDictionaryFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startListener with no Web Speech support', () => {
  test('shows an unsupported-browser indicator instead of throwing', async () => {
    // No webkitSpeechRecognition global at all — createRecognition returns null.
    stampConfig();

    await expect(importApp()).resolves.not.toThrow();

    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toMatch(/not supported/i);
    expect(document.getElementById('kikoe-idle').classList.contains('kikoe-chip-error')).toBe(true);
  });
});

describe('startListener recognition error handling', () => {
  // createRecognition wraps recognition.start/stop in its own safeStart/
  // safeStop before returning the same object, so the spies must live under
  // different names (nativeStart/nativeStop) to still observe native calls.
  class MockSpeechRecognition {
    constructor() {
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 1;
      this.lang = '';
      this.nativeStart = vi.fn();
      this.nativeStop = vi.fn();
      this.start = this.nativeStart;
      this.stop = this.nativeStop;
      MockSpeechRecognition.instances.push(this);
    }
  }
  MockSpeechRecognition.instances = [];

  beforeEach(() => {
    MockSpeechRecognition.instances = [];
    vi.stubGlobal('webkitSpeechRecognition', MockSpeechRecognition);
  });

  test('denied mic permission shows mic-denied and stops the restart loop', async () => {
    stampConfig();
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    const callsBeforeError = native.nativeStart.mock.calls.length;
    native.onerror({ error: 'not-allowed' });
    native.onend();

    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toMatch(/microphone access denied/i);
    // onend must not restart after a fatal, permission-style error.
    expect(native.nativeStart.mock.calls.length).toBe(callsBeforeError);
  });

  test('missing microphone shows no-mic and stops the restart loop', async () => {
    stampConfig();
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    const callsBeforeError = native.nativeStart.mock.calls.length;
    native.onerror({ error: 'audio-capture' });
    native.onend();

    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toMatch(/no microphone found/i);
    expect(native.nativeStart.mock.calls.length).toBe(callsBeforeError);
  });

  test('network error shows reconnecting and does not crash', async () => {
    stampConfig();
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    native.onerror({ error: 'network' });

    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toMatch(/reconnecting/i);
  });
});
