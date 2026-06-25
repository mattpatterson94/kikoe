import {
  createTranscriptContainer,
  logTranscript,
  clearTranscript,
} from '../src/live_transcript.js';

const defaultSettings = {
  transcript: true,
  transcript_background: '#ffd700',
  transcript_foreground: '#000000',
  transcript_position: 'top',
  transcript_delay: 5,
  transcript_count: 1,
  transcript_clear: false,
};

function settings(overrides = {}) {
  return { ...defaultSettings, ...overrides };
}

beforeEach(() => {
  document.body.innerHTML = '';
  // Reset COUNTER between tests by re-importing is impractical with vitest;
  // instead, create a fresh container each test and accept that COUNTER
  // accumulates — tests rely on the *content* of the container, not IDs.
  createTranscriptContainer(settings());
});

// ── createTranscriptContainer ─────────────────────────────────────────────────

describe('createTranscriptContainer', () => {
  test('appends a div with the expected id to document.body', () => {
    const el = document.getElementById('wanikani-voice-input-transcript-container');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('DIV');
  });

  test('applies position:absolute and top:0px for "top" position', () => {
    const el = document.getElementById('wanikani-voice-input-transcript-container');
    expect(el.style.position).toBe('absolute');
    expect(el.style.top).toBe('0px');
  });

  test('applies bottom:0px for "bottom" position', () => {
    document.body.innerHTML = '';
    createTranscriptContainer(settings({ transcript_position: 'bottom' }));
    const el = document.getElementById('wanikani-voice-input-transcript-container');
    expect(el.style.bottom).toBe('0px');
  });
});

// ── logTranscript ─────────────────────────────────────────────────────────────

describe('logTranscript', () => {
  test('does nothing when settings.transcript is false', () => {
    logTranscript(settings({ transcript: false }), { raw: 'した' });
    const container = document.getElementById('wanikani-voice-input-transcript-container');
    expect(container.children.length).toBe(0);
  });

  test('adds a paragraph with the raw text prefixed by 🎤', () => {
    logTranscript(settings(), { raw: 'した' });
    const container = document.getElementById('wanikani-voice-input-transcript-container');
    expect(container.children.length).toBe(1);
    expect(container.children[0].textContent).toContain('🎤した');
  });

  test('includes matched text in parentheses when provided', () => {
    logTranscript(settings(), { raw: 'した', matched: '下' });
    const container = document.getElementById('wanikani-voice-input-transcript-container');
    expect(container.children[0].textContent).toContain('(下)');
  });

  test('deduplicates: same raw without match does not add a second element', () => {
    logTranscript(settings(), { raw: 'した' });
    logTranscript(settings(), { raw: 'した' });
    const container = document.getElementById('wanikani-voice-input-transcript-container');
    expect(container.children.length).toBe(1);
  });

  test('replaces previous same-raw element when a match is found', () => {
    logTranscript(settings(), { raw: 'した' });
    logTranscript(settings(), { raw: 'した', matched: '下' });
    const container = document.getElementById('wanikani-voice-input-transcript-container');
    // The old one is removed; exactly one element remains with the match.
    const texts = Array.from(container.children).map(c => c.textContent);
    expect(texts.some(t => t.includes('(下)'))).toBe(true);
    expect(texts.filter(t => t.includes('🎤した')).length).toBe(1);
  });

  test('different raw values both appear when transcript_count allows it', () => {
    const s = settings({ transcript_count: 2 });
    logTranscript(s, { raw: 'した' });
    logTranscript(s, { raw: 'うえ' });
    const container = document.getElementById('wanikani-voice-input-transcript-container');
    const texts = Array.from(container.children).map(c => c.textContent);
    expect(texts.some(t => t.includes('した'))).toBe(true);
    expect(texts.some(t => t.includes('うえ'))).toBe(true);
  });

  test('only the latest transcript is shown when transcript_count is 1 (default)', () => {
    logTranscript(settings(), { raw: 'した' });
    logTranscript(settings(), { raw: 'うえ' });
    const container = document.getElementById('wanikani-voice-input-transcript-container');
    const texts = Array.from(container.children).map(c => c.textContent);
    expect(texts.some(t => t.includes('うえ'))).toBe(true);
    expect(texts.some(t => t.includes('した'))).toBe(false);
  });

  // Bug reproduction: logTranscript must not crash when the container has been
  // removed from the DOM (e.g. WaniKani re-renders and wipes its body content).
  test('REGRESSION: does not throw when the transcript container is missing', () => {
    document.body.innerHTML = ''; // simulate WaniKani wiping the body
    expect(() => {
      logTranscript(settings(), { raw: 'した' });
    }).not.toThrow();
  });

  // Bug reproduction: logTranscript must handle the case where it is called
  // with a plain string (the error-path in handleSpeechRecognition returned
  // a bare string instead of { raw } — verify it renders something readable).
  test('REGRESSION: handles string transcript gracefully (does not display "undefined")', () => {
    logTranscript(settings(), '!! no context !!');
    const container = document.getElementById('wanikani-voice-input-transcript-container');
    const text = container.children[0]?.textContent ?? '';
    expect(text).not.toContain('undefined');
  });
});

// ── clearTranscript ───────────────────────────────────────────────────────────

describe('clearTranscript', () => {
  test('empties the container', () => {
    logTranscript(settings(), { raw: 'した' });
    clearTranscript();
    const container = document.getElementById('wanikani-voice-input-transcript-container');
    expect(container.children.length).toBe(0);
  });

  // Bug reproduction: clearTranscript must not crash when the container was
  // removed from the DOM.
  test('REGRESSION: does not throw when container is missing', () => {
    document.body.innerHTML = '';
    expect(() => clearTranscript()).not.toThrow();
  });
});
