import {
  createTranscriptContainer,
  logTranscript,
  clearTranscript,
  showIdleIndicator,
  setIdleIndicatorState,
} from '../src/live_transcript.js';

const defaultSettings = {
  transcript: true,
  transcript_theme: 'system',
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
    const el = document.getElementById('kikoe-transcript-container');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('DIV');
  });

  test('applies position:fixed and top:16px for "top" position', () => {
    const el = document.getElementById('kikoe-transcript-container');
    expect(el.style.position).toBe('fixed');
    expect(el.style.top).toBe('16px');
  });

  test('applies bottom:16px for "bottom" position', () => {
    document.body.innerHTML = '';
    createTranscriptContainer(settings({ transcript_position: 'bottom' }));
    const el = document.getElementById('kikoe-transcript-container');
    expect(el.style.bottom).toBe('16px');
  });
});

// ── logTranscript ─────────────────────────────────────────────────────────────

describe('logTranscript', () => {
  test('does nothing when settings.transcript is false', () => {
    logTranscript(settings({ transcript: false }), { raw: 'した' });
    const container = document.getElementById('kikoe-transcript-container');
    expect(container.children.length).toBe(0);
  });

  test('adds a chip element with the raw text', () => {
    logTranscript(settings(), { raw: 'した' });
    const container = document.getElementById('kikoe-transcript-container');
    expect(container.children.length).toBe(1);
    expect(container.children[0].textContent).toContain('した');
  });

  test('includes matched text with arrow separator when provided', () => {
    logTranscript(settings(), { raw: 'した', matched: '下' });
    const container = document.getElementById('kikoe-transcript-container');
    expect(container.children[0].textContent).toContain('→ 下');
  });

  test('deduplicates: same raw without match does not add a second element', () => {
    logTranscript(settings(), { raw: 'した' });
    logTranscript(settings(), { raw: 'した' });
    const container = document.getElementById('kikoe-transcript-container');
    expect(container.children.length).toBe(1);
  });

  test('replaces previous same-raw element when a match is found', () => {
    logTranscript(settings(), { raw: 'した' });
    logTranscript(settings(), { raw: 'した', matched: '下' });
    const container = document.getElementById('kikoe-transcript-container');
    // The old one is removed; exactly one element remains with the match.
    const texts = Array.from(container.children).map(c => c.textContent);
    expect(texts.some(t => t.includes('→ 下'))).toBe(true);
    expect(texts.filter(t => t.includes('した')).length).toBe(1);
  });

  test('different raw values both appear when transcript_count allows it', () => {
    const s = settings({ transcript_count: 2 });
    logTranscript(s, { raw: 'した' });
    logTranscript(s, { raw: 'うえ' });
    const container = document.getElementById('kikoe-transcript-container');
    const texts = Array.from(container.children).map(c => c.textContent);
    expect(texts.some(t => t.includes('した'))).toBe(true);
    expect(texts.some(t => t.includes('うえ'))).toBe(true);
  });

  test('only the latest transcript is shown when transcript_count is 1 (default)', () => {
    logTranscript(settings(), { raw: 'した' });
    logTranscript(settings(), { raw: 'うえ' });
    const container = document.getElementById('kikoe-transcript-container');
    const texts = Array.from(container.children).map(c => c.textContent);
    expect(texts.some(t => t.includes('うえ'))).toBe(true);
    expect(texts.some(t => t.includes('した'))).toBe(false);
  });

  test('shows a "no match" hint for a no-match failure reason', () => {
    logTranscript(settings(), { raw: 'かい', reason: 'no-match' });
    const container = document.getElementById('kikoe-transcript-container');
    expect(container.children[0].textContent).toContain('かい');
    expect(container.children[0].textContent).toContain('no match');
  });

  test('shows a "loading" hint for a not-loaded failure reason', () => {
    logTranscript(settings(), { raw: 'かい', reason: 'not-loaded' });
    const container = document.getElementById('kikoe-transcript-container');
    expect(container.children[0].textContent).toContain('loading answers');
  });

  test('shows a reading-specific hint for a wrong-type failure on a reading question', () => {
    logTranscript(settings(), { raw: 'cold', reason: 'wrong-type', type: 'reading' });
    const container = document.getElementById('kikoe-transcript-container');
    expect(container.children[0].textContent).toContain("that's the meaning");
  });

  test('shows a meaning-specific hint for a wrong-type failure on a meaning question', () => {
    logTranscript(settings(), { raw: 'さむい', reason: 'wrong-type', type: 'meaning' });
    const container = document.getElementById('kikoe-transcript-container');
    expect(container.children[0].textContent).toContain("that's the reading");
  });

  test('does not show a hint when a match was found', () => {
    logTranscript(settings(), { raw: 'した', matched: '下' });
    const container = document.getElementById('kikoe-transcript-container');
    expect(container.children[0].textContent).not.toContain('no match');
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
    const container = document.getElementById('kikoe-transcript-container');
    const text = container.children[0]?.textContent ?? '';
    expect(text).not.toContain('undefined');
  });
});

// ── clearTranscript ───────────────────────────────────────────────────────────

describe('clearTranscript', () => {
  test('empties the container', () => {
    logTranscript(settings(), { raw: 'した' });
    clearTranscript();
    const container = document.getElementById('kikoe-transcript-container');
    expect(container.children.length).toBe(0);
  });

  // Bug reproduction: clearTranscript must not crash when the container was
  // removed from the DOM.
  test('REGRESSION: does not throw when container is missing', () => {
    document.body.innerHTML = '';
    expect(() => clearTranscript()).not.toThrow();
  });
});

// ── idle indicator ────────────────────────────────────────────────────────────

describe('setIdleIndicatorState', () => {
  test('shows restarting state in the idle chip', () => {
    showIdleIndicator(settings());
    setIdleIndicatorState('restarting');
    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toBe('Restarting…');
  });

  test('shows paused state in the idle chip', () => {
    showIdleIndicator(settings());
    setIdleIndicatorState('paused');
    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toBe('Paused');
  });

  test('shows retrying state in the idle chip', () => {
    showIdleIndicator(settings());
    setIdleIndicatorState('retrying');
    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toBe('Retrying…');
  });

  test('shows error state with error styling in the idle chip', () => {
    showIdleIndicator(settings());
    setIdleIndicatorState('error');
    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toBe('⚠ Subjects failed to load');
    expect(document.getElementById('kikoe-idle').classList.contains('kikoe-chip-error')).toBe(true);
  });

  test('clears error styling when leaving the error state', () => {
    showIdleIndicator(settings());
    setIdleIndicatorState('error');
    setIdleIndicatorState('listening');
    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toBe('Listening');
    expect(document.getElementById('kikoe-idle').classList.contains('kikoe-chip-error')).toBe(false);
  });

  test('shows unsupported-browser state with error styling', () => {
    showIdleIndicator(settings());
    setIdleIndicatorState('unsupported-browser');
    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toMatch(/not supported/i);
    expect(document.getElementById('kikoe-idle').classList.contains('kikoe-chip-error')).toBe(true);
  });

  test('shows mic-denied state with error styling', () => {
    showIdleIndicator(settings());
    setIdleIndicatorState('mic-denied');
    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toMatch(/microphone access denied/i);
    expect(document.getElementById('kikoe-idle').classList.contains('kikoe-chip-error')).toBe(true);
  });

  test('shows no-mic state with error styling', () => {
    showIdleIndicator(settings());
    setIdleIndicatorState('no-mic');
    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toMatch(/no microphone found/i);
    expect(document.getElementById('kikoe-idle').classList.contains('kikoe-chip-error')).toBe(true);
  });

  test('shows reconnecting state without error styling (transient)', () => {
    showIdleIndicator(settings());
    setIdleIndicatorState('reconnecting');
    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toBe('Reconnecting…');
    expect(document.getElementById('kikoe-idle').classList.contains('kikoe-chip-error')).toBe(false);
  });

  test('shows muted state with muted styling, not error styling', () => {
    showIdleIndicator(settings());
    setIdleIndicatorState('muted');
    const label = document.getElementById('kikoe-idle-label');
    expect(label.textContent).toBe('Muted');
    expect(document.getElementById('kikoe-idle').classList.contains('kikoe-chip-muted')).toBe(true);
    expect(document.getElementById('kikoe-idle').classList.contains('kikoe-chip-error')).toBe(false);
  });

  test('clears muted styling when leaving the muted state', () => {
    showIdleIndicator(settings());
    setIdleIndicatorState('muted');
    setIdleIndicatorState('listening');
    expect(document.getElementById('kikoe-idle').classList.contains('kikoe-chip-muted')).toBe(false);
  });
});

describe('showIdleIndicator click-to-toggle', () => {
  test('clicking the indicator invokes the onToggle callback', () => {
    const onToggle = vi.fn();
    showIdleIndicator(settings(), onToggle);
    document.getElementById('kikoe-idle').click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test('pressing Enter on the indicator invokes the onToggle callback', () => {
    const onToggle = vi.fn();
    showIdleIndicator(settings(), onToggle);
    document.getElementById('kikoe-idle').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test('no click handler is attached when onToggle is omitted', () => {
    showIdleIndicator(settings());
    expect(() => document.getElementById('kikoe-idle').click()).not.toThrow();
  });
});
