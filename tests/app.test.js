// app.js self-executes on import (reads the page-context config, detects the
// site, and starts the listener once a review/lesson/quiz page is detected).
// Each test re-imports it fresh with vi.resetModules() so the top-level setup
// runs again against that test's DOM/location/globals.

function stubReviewPage() {
  vi.stubGlobal('location', {
    hostname: 'www.wanikani.com',
    href: 'https://www.wanikani.com/subjects/review',
    pathname: '/subjects/review',
    hash: '',
  });
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

describe('startListener pending transcript retry on the initial card', () => {
  // Same MockSpeechRecognition shape as above — kept local to this describe
  // block so its instance list doesn't leak between describes.
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

  function setReviewCardDOM() {
    document.body.innerHTML += `
      <div class="character-header__characters">下</div>
      <span class="quiz-input__question-category">Kanji</span>
      <span class="quiz-input__question-type">Meaning</span>
      <input id="user-response" type="text" />
      <button class="quiz-input__submit-button">Next</button>
    `;
  }

  // Mimics the shape recognition.js expects from a native SpeechRecognition
  // result: an array-like of alternatives with an isFinal flag.
  function finalResult(...transcripts) {
    const alternatives = transcripts.map(t => ({ transcript: t }));
    alternatives.isFinal = true;
    return alternatives;
  }

  // Intercepts the content-script subject request so the test controls
  // exactly when (and whether) it resolves, instead of racing a real fetch.
  function interceptSubjectRequest() {
    let respond;
    const ready = new Promise((resolve) => {
      document.addEventListener('kikoe:subjectRequest', function handler(e) {
        document.removeEventListener('kikoe:subjectRequest', handler);
        const { prompt, category } = e.detail;
        respond = (subjects) => document.dispatchEvent(new CustomEvent('kikoe:subjectData', {
          detail: { prompt, category, subjects, error: null },
        }));
        resolve();
      });
    });
    return { ready, respond: (subjects) => respond(subjects) };
  }

  test('an answer spoken before the initial subjects arrive is submitted once they do', async () => {
    setReviewCardDOM();
    stampConfig({ hasApiToken: true });
    const subjectRequest = interceptSubjectRequest();

    await importApp();
    await subjectRequest.ready;

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult('below')] });

    const userResponse = document.getElementById('user-response');
    // Subjects haven't arrived yet — nothing should be submitted.
    expect(userResponse.value).toBe('');

    subjectRequest.respond([{
      id: 1, object: 'kanji',
      data: {
        slug: '下', characters: '下',
        meanings: [{ meaning: 'Below', accepted_answer: true }],
        auxiliary_meanings: [],
      },
    }]);

    await vi.waitFor(() => {
      if (userResponse.value !== 'below') throw new Error('not submitted yet');
    });
    expect(userResponse.value).toBe('below');
  });

  test('does not double-submit if the user speaks again after the retry succeeds', async () => {
    setReviewCardDOM();
    stampConfig({ hasApiToken: true });
    const subjectRequest = interceptSubjectRequest();

    await importApp();
    await subjectRequest.ready;

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult('below')] });

    subjectRequest.respond([{
      id: 1, object: 'kanji',
      data: {
        slug: '下', characters: '下',
        meanings: [{ meaning: 'Below', accepted_answer: true }],
        auxiliary_meanings: [],
      },
    }]);

    const userResponse = document.getElementById('user-response');
    await vi.waitFor(() => {
      if (userResponse.value !== 'below') throw new Error('not submitted yet');
    });

    native.onresult({ resultIndex: 0, results: [finalResult('under')] });
    expect(userResponse.value).toBe('below');
  });
});

describe('startListener voice commands', () => {
  // Same MockSpeechRecognition shape as above — kept local to this describe
  // block so its instance list doesn't leak between describes.
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

  function setReviewCardDOM() {
    document.body.innerHTML += `
      <div class="character-header__characters">下</div>
      <span class="quiz-input__question-category">Kanji</span>
      <span class="quiz-input__question-type">Meaning</span>
      <input id="user-response" type="text" />
      <button class="quiz-input__submit-button">Next</button>
    `;
  }

  // Mimics the shape recognition.js expects from a native SpeechRecognition
  // result: an array-like of alternatives with an isFinal flag.
  function finalResult(...transcripts) {
    const alternatives = transcripts.map(t => ({ transcript: t }));
    alternatives.isFinal = true;
    return alternatives;
  }

  // Intercepts the content-script subject request so the test controls
  // exactly when (and whether) it resolves, instead of racing a real fetch.
  function interceptSubjectRequest() {
    let respond;
    const ready = new Promise((resolve) => {
      document.addEventListener('kikoe:subjectRequest', function handler(e) {
        document.removeEventListener('kikoe:subjectRequest', handler);
        const { prompt, category } = e.detail;
        respond = (subjects) => document.dispatchEvent(new CustomEvent('kikoe:subjectData', {
          detail: { prompt, category, subjects, error: null },
        }));
        resolve();
      });
    });
    return { ready, respond: (subjects) => respond(subjects) };
  }

  test.each([
    ['Next.', 'trailing period + capitalized'],
    ['Next', 'capitalized only'],
    ['NEXT', 'all caps'],
    ['next', 'already lowercase'],
    ['next.', 'trailing period'],
    ['ネクスト。', 'katakana with Japanese full-width period'],
    ['次。', 'kanji with Japanese full-width period'],
  ])('"%s" (%s) triggers clickNext', async (transcript) => {
    setReviewCardDOM();
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    const nextButton = document.querySelector('.quiz-input__submit-button');
    const clickSpy = vi.spyOn(nextButton, 'click');

    native.onresult({ resultIndex: 0, results: [finalResult(transcript)] });

    expect(clickSpy).toHaveBeenCalled();
  });

  test('a final result whose top alternative is garbage but whose second is "next" still triggers the command', async () => {
    setReviewCardDOM();
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    const nextButton = document.querySelector('.quiz-input__submit-button');
    const clickSpy = vi.spyOn(nextButton, 'click');

    native.onresult({ resultIndex: 0, results: [finalResult('gibberish nonsense', 'Next.')] });

    expect(clickSpy).toHaveBeenCalled();
  });

  test('commands still work after an answer has been submitted', async () => {
    setReviewCardDOM();
    stampConfig({ hasApiToken: true });
    const subjectRequest = interceptSubjectRequest();

    await importApp();
    await subjectRequest.ready;

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult('below')] });

    subjectRequest.respond([{
      id: 1, object: 'kanji',
      data: {
        slug: '下', characters: '下',
        meanings: [{ meaning: 'Below', accepted_answer: true }],
        auxiliary_meanings: [],
      },
    }]);

    const userResponse = document.getElementById('user-response');
    await vi.waitFor(() => {
      if (userResponse.value !== 'below') throw new Error('not submitted yet');
    });

    const nextButton = document.querySelector('.quiz-input__submit-button');
    const clickSpy = vi.spyOn(nextButton, 'click');
    native.onresult({ resultIndex: 0, results: [finalResult('Next.')] });

    expect(clickSpy).toHaveBeenCalled();
  });
});
