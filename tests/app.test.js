// app.js self-executes on import (reads the page-context config, detects the
// site, and starts the listener once a review/lesson/quiz page is detected).
// Each test re-imports it fresh with vi.resetModules() so the top-level setup
// runs again against that test's DOM/location/globals.
//
// init() no longer awaits the dictionary fetch before starting the listener
// (see dict.js) — it starts synchronously and the mocked fetch below just
// needs to resolve without throwing.

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
  document.documentElement.dataset.kikoeConfig = JSON.stringify(config);
}

function stubDictionaryFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
}

async function importApp() {
  await import('../src/app');
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

describe('startListener mute/pause control', () => {
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
    // jsdom's document.hasFocus() defaults to false (no element is ever
    // focused), which reads as a blurred/backgrounded tab to isPageActive().
    // These tests are about explicit muting, not page-activity, so pin the
    // tab as foregrounded/focused like a real active review session.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
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

  function finalResult(...transcripts) {
    const alternatives = transcripts.map(t => ({ transcript: t }));
    alternatives.isFinal = true;
    return alternatives;
  }

  test.each([
    ['pause'],
    ['stop listening'],
    ['ストップ'],
  ])('saying "%s" mutes recognition and shows the Muted indicator', async (transcript) => {
    setReviewCardDOM();
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    const stopsBefore = native.nativeStop.mock.calls.length;
    native.onresult({ resultIndex: 0, results: [finalResult(transcript)] });

    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toBe('Muted');
    expect(native.nativeStop.mock.calls.length).toBeGreaterThan(stopsBefore);
  });

  test('clicking the idle indicator toggles mute then resume', async () => {
    setReviewCardDOM();
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    const indicator = document.getElementById('kikoe-idle');
    const label = document.getElementById('kikoe-idle-label');

    const startsBefore = native.nativeStart.mock.calls.length;
    indicator.click();
    expect(label.textContent).toBe('Muted');

    indicator.click();
    expect(label.textContent).toBe('Listening');
    expect(native.nativeStart.mock.calls.length).toBeGreaterThan(startsBefore);
  });

  test('clicking the indicator with no API token asks for the API token page instead of muting', async () => {
    setReviewCardDOM();
    stampConfig({ hasApiToken: false });
    await importApp();

    const indicator = document.getElementById('kikoe-idle');
    const label = document.getElementById('kikoe-idle-label');
    await vi.waitFor(() => {
      if (label.textContent !== '⚠ No API token') throw new Error('not in no-token state yet');
    });

    const openTokenPage = vi.fn();
    document.addEventListener('kikoe:openApiTokenPage', openTokenPage);
    const native = MockSpeechRecognition.instances[0];
    const stopsBefore = native.nativeStop.mock.calls.length;
    indicator.click();
    document.removeEventListener('kikoe:openApiTokenPage', openTokenPage);

    expect(openTokenPage).toHaveBeenCalledTimes(1);
    expect(label.textContent).toBe('⚠ No API token');
    expect(native.nativeStop.mock.calls.length).toBe(stopsBefore);
  });

  test('a muted mic stays muted across a tab blur/focus cycle', async () => {
    setReviewCardDOM();
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult('pause')] });

    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toBe('Muted');

    const startsBeforeBlur = native.nativeStart.mock.calls.length;
    document.hasFocus.mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    document.hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));

    // Blur/focus must not silently un-mute an explicit user mute.
    expect(label.textContent).toBe('Muted');
    expect(native.nativeStart.mock.calls.length).toBe(startsBeforeBlur);
  });
});

describe('startListener BunPro Reveal & Grade cards', () => {
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
    vi.stubGlobal('location', {
      hostname: 'bunpro.jp',
      href: 'https://bunpro.jp/study',
      pathname: '/study',
      hash: '',
    });
  });

  function addMetadata(overrides = {}) {
    const el = document.createElement('div');
    el.id = 'quiz-metadata-element';
    const attrs = {
      'data-meta-loc': 'review',
      'data-meta-is-correct': 'false',
      'data-meta-is-post-attempt': 'false',
      'data-meta-info': JSON.stringify({ id: 806, type: 'grammar' }),
      'data-meta-input-mode': 'flashcard',
      'data-meta-question-mode': 'flashcard',
      ...overrides,
    };
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
  }

  function addButton(text) {
    const button = document.createElement('button');
    button.textContent = text;
    document.body.appendChild(button);
    return button;
  }

  function finalResult(...transcripts) {
    const alternatives = transcripts.map(t => ({ transcript: t }));
    alternatives.isFinal = true;
    return alternatives;
  }

  function interimResult(...transcripts) {
    const alternatives = transcripts.map(t => ({ transcript: t }));
    alternatives.isFinal = false;
    return alternatives;
  }

  test('a reveal card shows the Listening indicator, not unsupported', async () => {
    addMetadata();
    addButton('Show Answer');
    stampConfig({ hasApiToken: true });
    await importApp();

    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toBe('Listening');
  });

  test.each([
    ['Reveal.'],
    ['show answer'],
    ['見せて。'],
  ])('saying "%s" while the answer is hidden clicks the reveal button', async (transcript) => {
    addMetadata();
    const revealButton = addButton('Show Answer');
    const clickSpy = vi.spyOn(revealButton, 'click');
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult(transcript)] });

    expect(clickSpy).toHaveBeenCalled();
  });

  test.each([
    ['Good.', 'good'],
    ['known', 'good'],
    ['わかった。', 'good'],
    ['Bad.', 'bad'],
    ['again', 'bad'],
    ['わからない', 'bad'],
  ])('saying "%s" once revealed grades %s', async (transcript, grade) => {
    addMetadata({ 'data-meta-is-post-attempt': 'true' });
    const goodButton = addButton('Good');
    const badButton = addButton('Bad');
    const goodSpy = vi.spyOn(goodButton, 'click');
    const badSpy = vi.spyOn(badButton, 'click');
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult(transcript)] });

    expect((grade === 'good' ? goodSpy : badSpy)).toHaveBeenCalled();
    expect((grade === 'good' ? badSpy : goodSpy)).not.toHaveBeenCalled();
  });

  test('grade words are ignored while the answer is still hidden', async () => {
    addMetadata();
    const revealButton = addButton('Show Answer');
    const clickSpy = vi.spyOn(revealButton, 'click');
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult('good')] });

    expect(clickSpy).not.toHaveBeenCalled();
    const container = document.getElementById('kikoe-transcript-container');
    expect(container.textContent).toContain('say "reveal"');
  });

  test('an unmatched word once revealed hints at the grade commands', async () => {
    addMetadata({ 'data-meta-is-post-attempt': 'true' });
    addButton('Good');
    addButton('Bad');
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult('banana')] });

    const container = document.getElementById('kikoe-transcript-container');
    expect(container.textContent).toContain('say "good" or "bad"');
  });

  test('shared commands like "pause" still work on reveal cards', async () => {
    addMetadata();
    addButton('Show Answer');
    stampConfig({ hasApiToken: true });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult('pause')] });

    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toBe('Muted');
  });

  test('manual-input cards still go through the checkAnswer path', async () => {
    addMetadata({
      'data-meta-input-mode': 'manual',
      'data-meta-question-mode': 'cloze',
      'data-meta-answers-array': JSON.stringify(['おとこ']),
    });
    const input = document.createElement('input');
    input.id = 'js-manual-input';
    document.body.appendChild(input);
    const submit = document.createElement('button');
    submit.className = 'InputManual__button';
    document.body.appendChild(submit);
    const submitSpy = vi.spyOn(submit, 'click');
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult('おとこ')] });

    expect(input.value).toBe('おとこ');
    expect(submitSpy).toHaveBeenCalled();
  });

  test('a late final for an interim-submitted answer does not show a mismatch on the next card', async () => {
    const meta = addMetadata({
      'data-meta-input-mode': 'manual',
      'data-meta-question-mode': 'cloze',
      'data-meta-answers-array': JSON.stringify(['おとこ']),
    });
    const input = document.createElement('input');
    input.id = 'js-manual-input';
    document.body.appendChild(input);
    const submit = document.createElement('button');
    submit.className = 'InputManual__button';
    document.body.appendChild(submit);
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    vi.useFakeTimers();
    try {
      native.onresult({ resultIndex: 0, results: [interimResult('おとこ')] });
      vi.advanceTimersByTime(900);
      expect(input.value).toBe('おとこ');

      meta.setAttribute('data-meta-is-post-attempt', 'true');
      meta.setAttribute('data-meta-total-submissions-count', '1');
      await Promise.resolve();
      vi.advanceTimersByTime(60);

      meta.setAttribute('data-meta-is-post-attempt', 'false');
      meta.setAttribute('data-meta-info', JSON.stringify({ id: 807, type: 'grammar' }));
      meta.setAttribute('data-meta-answers-array', JSON.stringify(['おんな']));
      await Promise.resolve();
      vi.advanceTimersByTime(60);

      native.onresult({ resultIndex: 0, results: [finalResult('おとこ')] });
      expect(document.getElementById('kikoe-transcript-container').textContent).not.toContain('no match');

      native.onresult({ resultIndex: 0, results: [finalResult('おんな')] });
      expect(input.value).toBe('おんな');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('startListener fuzzy meaning matching (WaniKani)', () => {
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

  function finalResult(...transcripts) {
    const alternatives = transcripts.map(t => ({ transcript: t }));
    alternatives.isFinal = true;
    return alternatives;
  }

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

  test('a near-miss meaning (edit distance within WaniKani tolerance) still submits the canonical meaning', async () => {
    setReviewCardDOM();
    stampConfig({ hasApiToken: true });
    const subjectRequest = interceptSubjectRequest();

    await importApp();
    await subjectRequest.ready;
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
      if (!document.getElementById('kikoe-idle-label')?.textContent) throw new Error('not ready yet');
    });

    // "belou" is one substitution away from "below" — within the 5-char
    // tolerance (1) WaniKani's own fuzzy check allows.
    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult('belou')] });

    await vi.waitFor(() => {
      if (userResponse.value !== 'below') throw new Error('not submitted yet');
    });
    expect(userResponse.value).toBe('below');
  });
});

describe('startListener transcript failure reason hints', () => {
  // Same MockSpeechRecognition shape as above — kept local to this describe
  // block so its instance list doesn't leak between describes.
  class MockSpeechRecognition {
    constructor() {
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 5;
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

  function setReadingCardDOM() {
    document.body.innerHTML += `
      <div class="character-header__characters">寒い</div>
      <span class="quiz-input__question-category">Vocabulary</span>
      <span class="quiz-input__question-type">Reading</span>
      <input id="user-response" type="text" />
      <button class="quiz-input__submit-button">Next</button>
    `;
  }

  function finalResult(...transcripts) {
    const alternatives = transcripts.map(t => ({ transcript: t }));
    alternatives.isFinal = true;
    return alternatives;
  }

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

  async function loadReadingSubjects() {
    setReadingCardDOM();
    stampConfig({ hasApiToken: true });
    const subjectRequest = interceptSubjectRequest();
    await importApp();
    await subjectRequest.ready;
    subjectRequest.respond([{
      id: 1, object: 'vocabulary',
      data: {
        slug: '寒い', characters: '寒い',
        readings: [{ reading: 'さむい', accepted_answer: true }],
        meanings: [{ meaning: 'Cold Hearted', accepted_answer: true }],
        auxiliary_meanings: [],
      },
    }]);
    await vi.waitFor(() => {
      if (document.getElementById('kikoe-idle-label')?.textContent !== 'Listening') {
        throw new Error('subjects not loaded yet');
      }
    });
    return MockSpeechRecognition.instances[0];
  }

  test('speaking the meaning on a reading question shows a wrong-type hint', async () => {
    const native = await loadReadingSubjects();
    native.onresult({ resultIndex: 0, results: [finalResult('Cold Hearted')] });

    const container = document.getElementById('kikoe-transcript-container');
    await vi.waitFor(() => {
      if (!container.textContent.includes('reading')) throw new Error('hint not shown yet');
    });
    expect(container.textContent).toContain("that's the meaning — say the reading");
  });

  test('an unrecognisable answer shows a plain no-match hint', async () => {
    const native = await loadReadingSubjects();
    native.onresult({ resultIndex: 0, results: [finalResult('gibberish')] });

    const container = document.getElementById('kikoe-transcript-container');
    await vi.waitFor(() => {
      if (!container.textContent.includes('no match')) throw new Error('hint not shown yet');
    });
    expect(container.textContent).toContain('no match');
    expect(container.querySelector('.kikoe-chip-clickable')).not.toBeNull();
    expect(container.querySelector('[aria-label*="さむい"]')).not.toBeNull();
  });

  test('confirming a no-match correction submits the intended answer', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const native = await loadReadingSubjects();
    native.onresult({ resultIndex: 0, results: [finalResult('gibberish')] });

    const container = document.getElementById('kikoe-transcript-container');
    await vi.waitFor(() => {
      if (!container.querySelector('.kikoe-chip-clickable')) throw new Error('correction bubble not shown yet');
    });
    container.querySelector('.kikoe-chip-clickable').click();

    expect(document.getElementById('user-response').value).toBe('さむい');
  });

  test('the most informative reason wins across alternatives (wrong-type over no-match)', async () => {
    const native = await loadReadingSubjects();
    // First alternative is unrecognisable gibberish (no-match); the second
    // is the meaning, not the reading (wrong-type) — the more actionable
    // hint should surface even though it came from a lower-ranked alternative.
    native.onresult({ resultIndex: 0, results: [finalResult('gibberish nonsense', 'Cold Hearted')] });

    const container = document.getElementById('kikoe-transcript-container');
    await vi.waitFor(() => {
      if (!container.textContent.includes('reading')) throw new Error('hint not shown yet');
    });
    expect(container.textContent).toContain("that's the meaning — say the reading");
    // The heard text shown should still be the top alternative, not the one
    // that supplied the reason.
    expect(container.textContent).toContain('gibberish nonsense');
  });
});

describe('startListener ippatsu mode (one-shot auto-submit on a miss)', () => {
  // Same MockSpeechRecognition shape as above — kept local to this describe
  // block so its instance list doesn't leak between describes.
  class MockSpeechRecognition {
    constructor() {
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 5;
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

  function setCardDOM(type) {
    document.body.innerHTML += `
      <div class="character-header__characters">寒い</div>
      <span class="quiz-input__question-category">Vocabulary</span>
      <span class="quiz-input__question-type">${type}</span>
      <input id="user-response" type="text" />
      <button class="quiz-input__submit-button">Next</button>
    `;
  }

  function finalResult(...transcripts) {
    const alternatives = transcripts.map(t => ({ transcript: t }));
    alternatives.isFinal = true;
    return alternatives;
  }

  function interimResult(...transcripts) {
    const alternatives = transcripts.map(t => ({ transcript: t }));
    alternatives.isFinal = false;
    return alternatives;
  }

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

  const subject = {
    id: 1, object: 'vocabulary',
    data: {
      slug: '寒い', characters: '寒い',
      readings: [{ reading: 'さむい', accepted_answer: true }],
      meanings: [{ meaning: 'Cold Hearted', accepted_answer: true }],
      auxiliary_meanings: [],
    },
  };

  // Starts the listener on a card of the given question type with the given
  // settings and waits until the subject data has been loaded, so utterances
  // fired afterwards hit the normal (non-pending) check path.
  async function loadCard(type, settings) {
    setCardDOM(type);
    stampConfig({ hasApiToken: true, settings });
    const subjectRequest = interceptSubjectRequest();
    await importApp();
    await subjectRequest.ready;
    subjectRequest.respond([subject]);
    await vi.waitFor(() => {
      if (document.getElementById('kikoe-idle-label')?.textContent !== 'Listening') {
        throw new Error('subjects not loaded yet');
      }
    });
    return MockSpeechRecognition.instances[0];
  }

  test('a genuine miss on a reading question auto-submits as wrong', async () => {
    const native = await loadCard('Reading', { ippatsu_reading: true });
    native.onresult({ resultIndex: 0, results: [finalResult('gibberish')] });

    // markWrong submits the guaranteed-wrong Japanese placeholder.
    expect(document.getElementById('user-response').value).toBe('あああ');
  });

  test('a genuine miss on a meaning question auto-submits as wrong', async () => {
    const native = await loadCard('Meaning', { ippatsu_meaning: true });
    native.onresult({ resultIndex: 0, results: [finalResult('warm hearted')] });

    expect(document.getElementById('user-response').value).toBe('aaa');
  });

  test('a miss is ignored as before when ippatsu is off', async () => {
    const native = await loadCard('Reading', {});
    native.onresult({ resultIndex: 0, results: [finalResult('gibberish')] });

    expect(document.getElementById('user-response').value).toBe('');
  });

  test('the meaning toggle does not affect reading questions', async () => {
    const native = await loadCard('Reading', { ippatsu_meaning: true });
    native.onresult({ resultIndex: 0, results: [finalResult('gibberish')] });

    expect(document.getElementById('user-response').value).toBe('');
  });

  test('a wrong-type utterance (recognizer glitch) does not burn the shot', async () => {
    const native = await loadCard('Reading', { ippatsu_reading: true });
    // The meaning spoken on a reading question — a hint, not a miss.
    native.onresult({ resultIndex: 0, results: [finalResult('Cold Hearted')] });
    expect(document.getElementById('user-response').value).toBe('');

    // The retry can still succeed.
    native.onresult({ resultIndex: 0, results: [finalResult('さむい')] });
    expect(document.getElementById('user-response').value).toBe('さむい');
  });

  test('a correct answer still submits normally with ippatsu on', async () => {
    const native = await loadCard('Reading', { ippatsu_reading: true });
    native.onresult({ resultIndex: 0, results: [finalResult('さむい')] });

    expect(document.getElementById('user-response').value).toBe('さむい');
  });

  test('a matched reading interim submits if no final result arrives', async () => {
    const native = await loadCard('Reading', {});
    vi.useFakeTimers();
    try {
      native.onresult({ resultIndex: 0, results: [interimResult('さむい')] });

      expect(document.getElementById('user-response').value).toBe('');
      vi.advanceTimersByTime(899);
      expect(document.getElementById('user-response').value).toBe('');

      vi.advanceTimersByTime(1);
      expect(document.getElementById('user-response').value).toBe('さむい');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a failed submit does not block the next valid utterance', async () => {
    const native = await loadCard('Reading', { ippatsu_reading: true });
    document.querySelector('.quiz-input__submit-button').remove();

    native.onresult({ resultIndex: 0, results: [finalResult('さむい')] });
    expect(document.getElementById('user-response').value).toBe('さむい');

    const retryButton = document.createElement('button');
    retryButton.className = 'quiz-input__submit-button';
    const clickSpy = vi.spyOn(retryButton, 'click');
    document.body.append(retryButton);
    document.getElementById('user-response').value = '';

    native.onresult({ resultIndex: 0, results: [finalResult('さむい')] });

    expect(document.getElementById('user-response').value).toBe('さむい');
    expect(clickSpy).toHaveBeenCalled();
  });

  test('speech after an auto-submitted miss is ignored until the card changes', async () => {
    const native = await loadCard('Reading', { ippatsu_reading: true });
    native.onresult({ resultIndex: 0, results: [finalResult('gibberish')] });
    expect(document.getElementById('user-response').value).toBe('あああ');

    // Even the correct reading must not overwrite the submitted miss.
    native.onresult({ resultIndex: 0, results: [finalResult('さむい')] });
    expect(document.getElementById('user-response').value).toBe('あああ');
  });

  test('a miss spoken before subjects arrive auto-submits once they load', async () => {
    setCardDOM('Reading');
    stampConfig({ hasApiToken: true, settings: { ippatsu_reading: true } });
    const subjectRequest = interceptSubjectRequest();
    await importApp();
    await subjectRequest.ready;

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult('gibberish')] });
    // Subjects haven't arrived — the shot isn't burned yet.
    expect(document.getElementById('user-response').value).toBe('');

    subjectRequest.respond([subject]);
    await vi.waitFor(() => {
      if (document.getElementById('user-response').value !== 'あああ') {
        throw new Error('miss not auto-submitted yet');
      }
    });
  });
});

describe('startListener help panel', () => {
  // Same MockSpeechRecognition shape as above — kept local to this describe
  // block so its instance list doesn't leak between describes.
  class MockSpeechRecognition {
    constructor() {
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 5;
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
    // Pin the tab as focused so pause/resume reflects the help panel, not
    // jsdom's default blurred state (see the mute/pause describe above).
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  function setMeaningCardDOM() {
    document.body.innerHTML += `
      <div class="character-header__characters">下</div>
      <span class="quiz-input__question-category">Kanji</span>
      <span class="quiz-input__question-type">Meaning</span>
      <input id="user-response" type="text" />
      <button class="quiz-input__submit-button">Next</button>
    `;
  }

  function finalResult(...transcripts) {
    const alternatives = transcripts.map(t => ({ transcript: t }));
    alternatives.isFinal = true;
    return alternatives;
  }

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

  function kanjiSubject(meaning) {
    return {
      id: 1, object: 'kanji',
      data: {
        slug: '下', characters: '下',
        meanings: [{ meaning, accepted_answer: true }],
        auxiliary_meanings: [],
      },
    };
  }

  // Starts the listener on a meaning card and waits for subjects, so
  // utterances afterwards hit the normal (non-pending) check path.
  async function loadMeaningCard(meaning, settings = {}) {
    setMeaningCardDOM();
    stampConfig({ hasApiToken: true, settings });
    const subjectRequest = interceptSubjectRequest();
    await importApp();
    await subjectRequest.ready;
    subjectRequest.respond([kanjiSubject(meaning)]);
    await vi.waitFor(() => {
      if (document.getElementById('kikoe-idle-label')?.textContent !== 'Listening') {
        throw new Error('subjects not loaded yet');
      }
    });
    return MockSpeechRecognition.instances[0];
  }

  test('saying "help" opens the panel and pauses recognition', async () => {
    const native = await loadMeaningCard('Below');

    const stopsBefore = native.nativeStop.mock.calls.length;
    native.onresult({ resultIndex: 0, results: [finalResult('Help.')] });

    expect(document.getElementById('kikoe-help-panel')).not.toBeNull();
    expect(document.getElementById('kikoe-idle-label').textContent).toBe('Paused');
    expect(native.nativeStop.mock.calls.length).toBeGreaterThan(stopsBefore);
  });

  test('on a card whose accepted meaning is "help", saying it submits the answer instead of opening the panel', async () => {
    const native = await loadMeaningCard('Help');

    native.onresult({ resultIndex: 0, results: [finalResult('help')] });

    expect(document.getElementById('user-response').value).toBe('help');
    expect(document.getElementById('kikoe-help-panel')).toBeNull();
  });

  test('saying "help" with ippatsu on opens the panel without burning the shot', async () => {
    const native = await loadMeaningCard('Below', { ippatsu_meaning: true });

    native.onresult({ resultIndex: 0, results: [finalResult('help')] });

    expect(document.getElementById('kikoe-help-panel')).not.toBeNull();
    // No wrong-answer placeholder was submitted.
    expect(document.getElementById('user-response').value).toBe('');
  });

  test('Escape closes the panel and resumes recognition', async () => {
    const native = await loadMeaningCard('Below');
    native.onresult({ resultIndex: 0, results: [finalResult('help')] });
    expect(document.getElementById('kikoe-help-panel')).not.toBeNull();

    const startsBefore = native.nativeStart.mock.calls.length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.getElementById('kikoe-help-panel')).toBeNull();
    expect(document.getElementById('kikoe-idle-label').textContent).toBe('Listening');
    expect(native.nativeStart.mock.calls.length).toBeGreaterThan(startsBefore);
  });

  test('closing the panel does not clobber an explicit user mute', async () => {
    const native = await loadMeaningCard('Below');
    native.onresult({ resultIndex: 0, results: [finalResult('pause')] });
    expect(document.getElementById('kikoe-idle-label').textContent).toBe('Muted');

    // Open via the chip (voice is muted), then close again.
    document.getElementById('kikoe-help-chip').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.getElementById('kikoe-idle-label').textContent).toBe('Muted');
  });

  test('clicking the ? chip toggles the panel open and closed', async () => {
    await loadMeaningCard('Below');

    const chip = document.getElementById('kikoe-help-chip');
    expect(chip).not.toBeNull();
    chip.click();
    expect(document.getElementById('kikoe-help-panel')).not.toBeNull();
    chip.click();
    expect(document.getElementById('kikoe-help-panel')).toBeNull();
  });

  test('the chip is not created when show_help_button is off, but saying "help" still works', async () => {
    const native = await loadMeaningCard('Below', { show_help_button: false, help_hint_shown: true });

    expect(document.getElementById('kikoe-help-chip')).toBeNull();
    native.onresult({ resultIndex: 0, results: [finalResult('help')] });
    expect(document.getElementById('kikoe-help-panel')).not.toBeNull();
  });

  test('saying "help" on a BunPro reveal card opens the panel', async () => {
    vi.stubGlobal('location', {
      hostname: 'bunpro.jp',
      href: 'https://bunpro.jp/study',
      pathname: '/study',
      hash: '',
    });
    const el = document.createElement('div');
    el.id = 'quiz-metadata-element';
    el.setAttribute('data-meta-loc', 'review');
    el.setAttribute('data-meta-is-correct', 'false');
    el.setAttribute('data-meta-is-post-attempt', 'false');
    el.setAttribute('data-meta-info', JSON.stringify({ id: 806, type: 'grammar' }));
    el.setAttribute('data-meta-input-mode', 'flashcard');
    el.setAttribute('data-meta-question-mode', 'flashcard');
    document.body.appendChild(el);
    stampConfig({ hasApiToken: true });
    await importApp();

    const native = MockSpeechRecognition.instances[0];
    native.onresult({ resultIndex: 0, results: [finalResult('help')] });

    const panel = document.getElementById('kikoe-help-panel');
    expect(panel).not.toBeNull();
    // Context-aware: the reveal command is listed on a hidden-answer card.
    expect(panel.textContent).toContain('Show the answer');
  });

  test('the first session shows the one-time hint and reports it as seen', async () => {
    const seen = vi.fn();
    document.addEventListener('kikoe:helpHintSeen', seen);
    setMeaningCardDOM();
    stampConfig({ hasApiToken: true });
    await importApp();
    document.removeEventListener('kikoe:helpHintSeen', seen);

    expect(document.getElementById('kikoe-help-hint')).not.toBeNull();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test('no hint once help_hint_shown is set', async () => {
    setMeaningCardDOM();
    stampConfig({ hasApiToken: true, settings: { help_hint_shown: true } });
    await importApp();

    expect(document.getElementById('kikoe-help-hint')).toBeNull();
  });
});
