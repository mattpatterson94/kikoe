import {
  getLanguage, getContext, didContextChange,
  inputAnswer, submitAnswer, markWrong, clickNext, clickInfo,
  reveal, gradeGood, gradeBad,
  createCardWatcher,
} from '../src/bunpro';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Attribute values mirror the live #quiz-metadata-element BunPro renders for
// third-party review tools (verified 2026-07-02).
function metadataAttrs(overrides = {}) {
  return {
    'data-meta-loc': 'review',
    'data-meta-is-correct': 'false',
    'data-meta-is-post-attempt': 'false',
    'data-meta-info': JSON.stringify({ id: 806, type: 'vocab' }),
    'data-meta-input-mode': 'manual',
    'data-meta-question-mode': 'cloze',
    'data-meta-answers-array': JSON.stringify(['おとこ']),
    ...overrides,
  };
}

function addMetadata(overrides = {}) {
  const el = document.createElement('div');
  el.id = 'quiz-metadata-element';
  for (const [k, v] of Object.entries(metadataAttrs(overrides))) {
    el.setAttribute(k, v);
  }
  document.body.appendChild(el);
  return el;
}

function addButton(text, title = '') {
  const button = document.createElement('button');
  button.textContent = text;
  if (title) button.title = title;
  button.addEventListener('click', () => { button.clicked = true; });
  document.body.appendChild(button);
  return button;
}

function addInput() {
  const input = document.createElement('input');
  input.id = 'js-manual-input';
  input.className = 'InputManual__input';
  document.body.appendChild(input);

  const button = document.createElement('button');
  button.className = 'InputManual__button';
  button.addEventListener('click', () => { button.clicked = true; });
  document.body.appendChild(button);
  return { input, button };
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ── getLanguage ───────────────────────────────────────────────────────────────

describe('getLanguage', () => {
  test('cloze question → ja-JP', () => {
    addMetadata({ 'data-meta-question-mode': 'cloze' });
    expect(getLanguage()).toBe('ja-JP');
  });

  test('translate question → en-US', () => {
    addMetadata({ 'data-meta-question-mode': 'translate' });
    expect(getLanguage()).toBe('en-US');
  });

  test('missing metadata element falls back to en-US', () => {
    expect(getLanguage()).toBe('en-US');
  });
});

// ── getContext ────────────────────────────────────────────────────────────────

describe('getContext', () => {
  test('returns null when metadata element is absent', () => {
    expect(getContext()).toBeNull();
  });

  test('cloze card → type reading with answers as readings', () => {
    addMetadata();
    const ctx = getContext();
    expect(ctx.page).toBe('review');
    expect(ctx.type).toBe('reading');
    expect(ctx.readings).toEqual(['おとこ']);
    expect(ctx.meanings).toEqual([]);
    expect(ctx.category).toBe('vocab');
  });

  test('translate card → type meaning with answers as meanings', () => {
    addMetadata({
      'data-meta-question-mode': 'translate',
      'data-meta-answers-array': JSON.stringify(['man', 'male']),
    });
    const ctx = getContext();
    expect(ctx.type).toBe('meaning');
    expect(ctx.meanings).toEqual(['man', 'male']);
    expect(ctx.readings).toEqual([]);
  });

  test('prompt combines item id and submission count', () => {
    addMetadata({ 'data-meta-total-submissions-count': '3' });
    expect(getContext().prompt).toBe('806:3');
  });

  test('prompt defaults submission count to 0 when the attribute is absent', () => {
    addMetadata();
    expect(getContext().prompt).toBe('806:0');
  });

  test('learn loc → page lesson; unknown loc → page quiz', () => {
    const el = addMetadata({ 'data-meta-loc': 'learn' });
    expect(getContext().page).toBe('lesson');
    el.setAttribute('data-meta-loc', 'cram');
    expect(getContext().page).toBe('quiz');
  });

  test('non-manual input mode (Reveal & Grade) → reveal mode, answer hidden', () => {
    addMetadata({ 'data-meta-input-mode': 'flashcard' });
    const ctx = getContext();
    expect(ctx.mode).toBe('reveal');
    expect(ctx.revealed).toBe(false);
    expect(ctx.page).toBe('review');
    expect(ctx.prompt).toBe('806:0');
    expect(ctx.type).toBeUndefined();
  });

  test('reveal card is revealed once data-meta-is-post-attempt flips', () => {
    addMetadata({
      'data-meta-input-mode': 'flashcard',
      'data-meta-is-post-attempt': 'true',
    });
    expect(getContext().revealed).toBe(true);
  });

  test('reveal card falls back to grade-button detection when the flag has not flipped', () => {
    addMetadata({ 'data-meta-input-mode': 'flashcard' });
    addButton('Good');
    addButton('Bad');
    expect(getContext().revealed).toBe(true);
  });

  test('a lone grade-like button does not count as revealed', () => {
    addMetadata({ 'data-meta-input-mode': 'flashcard' });
    addButton('Good');
    expect(getContext().revealed).toBe(false);
  });

  test('unknown question mode passes through as the type', () => {
    addMetadata({ 'data-meta-question-mode': 'listening' });
    expect(getContext().type).toBe('listening');
  });

  test('malformed answers array → empty answers, no throw', () => {
    addMetadata({ 'data-meta-answers-array': 'not json' });
    const ctx = getContext();
    expect(ctx.readings).toEqual([]);
    expect(ctx.meanings).toEqual([]);
  });
});

// ── didContextChange ──────────────────────────────────────────────────────────

describe('didContextChange', () => {
  const base = { prompt: '806:0', type: 'reading' };

  test('same prompt and type → no change', () => {
    expect(didContextChange(base, { ...base })).toBe(false);
  });

  test('different prompt → changed', () => {
    expect(didContextChange(base, { prompt: '807:0', type: 'reading' })).toBe(true);
  });

  test('same item with a new submission count → changed', () => {
    expect(didContextChange(base, { prompt: '806:1', type: 'reading' })).toBe(true);
  });

  test('null old context → changed', () => {
    expect(didContextChange(null, base)).toBe(true);
  });
});

// ── inputAnswer / submitAnswer ────────────────────────────────────────────────

describe('inputAnswer', () => {
  test('sets the value via the native setter and dispatches a bubbling input event', () => {
    const { input } = addInput();
    let bubbled = false;
    document.body.addEventListener('input', () => { bubbled = true; });
    expect(inputAnswer('おとこ')).toBe(true);
    expect(input.value).toBe('おとこ');
    expect(bubbled).toBe(true);
  });

  test('returns false and does not throw when the input is absent', () => {
    expect(inputAnswer('おとこ')).toBe(false);
  });
});

describe('submitAnswer', () => {
  test('fills the input and clicks the submit button', () => {
    const { input, button } = addInput();
    expect(submitAnswer('おとこ')).toBe(true);
    expect(input.value).toBe('おとこ');
    expect(button.clicked).toBe(true);
  });

  test('no-op when the input is missing', () => {
    expect(submitAnswer('おとこ')).toBe(false);
  });
});

// ── markWrong ─────────────────────────────────────────────────────────────────

describe('markWrong', () => {
  test('submits a Japanese non-answer for cloze cards', () => {
    addMetadata({ 'data-meta-question-mode': 'cloze' });
    const { input, button } = addInput();
    markWrong();
    expect(input.value).toBe('あああ');
    expect(button.clicked).toBe(true);
  });

  test('submits an English non-answer for translate cards', () => {
    addMetadata({ 'data-meta-question-mode': 'translate' });
    const { input } = addInput();
    markWrong();
    expect(input.value).toBe('aaa');
  });
});

// ── clickNext / clickInfo ─────────────────────────────────────────────────────

describe('clickNext', () => {
  test('clicks a button whose title mentions "Next question"', () => {
    const button = document.createElement('button');
    button.title = 'Next question (Enter)';
    button.addEventListener('click', () => { button.clicked = true; });
    document.body.appendChild(button);
    expect(clickNext()).toBe(true);
    expect(button.clicked).toBe(true);
  });

  test('returns false when no such button exists', () => {
    expect(clickNext()).toBe(false);
  });
});

// ── reveal / gradeGood / gradeBad ─────────────────────────────────────────────

describe('reveal', () => {
  test('clicks a button whose text says Show Answer', () => {
    const button = addButton('Show Answer');
    expect(reveal()).toBe(true);
    expect(button.clicked).toBe(true);
  });

  test('matches by title as well as text', () => {
    const button = addButton('', 'Reveal answer (Space)');
    expect(reveal()).toBe(true);
    expect(button.clicked).toBe(true);
  });

  test('returns false when no reveal button exists', () => {
    addButton('Good');
    expect(reveal()).toBe(false);
  });
});

describe('gradeGood / gradeBad', () => {
  test('each clicks its own button and not the other', () => {
    const good = addButton('Good');
    const bad = addButton('Bad');

    expect(gradeGood()).toBe(true);
    expect(good.clicked).toBe(true);
    expect(bad.clicked).toBeUndefined();

    expect(gradeBad()).toBe(true);
    expect(bad.clicked).toBe(true);
  });

  test('matches whole words only — "Goodbye" is not a Good button', () => {
    addButton('Goodbye');
    expect(gradeGood()).toBe(false);
  });

  test('return false when the buttons are absent', () => {
    expect(gradeGood()).toBe(false);
    expect(gradeBad()).toBe(false);
  });
});

describe('clickInfo', () => {
  test('clicks the hint toggle button', () => {
    const button = document.createElement('button');
    button.title = 'Toggle the hint level';
    button.addEventListener('click', () => { button.clicked = true; });
    document.body.appendChild(button);
    clickInfo();
    expect(button.clicked).toBe(true);
  });

  test('does not throw when the hint button is absent', () => {
    expect(() => clickInfo()).not.toThrow();
  });
});

// ── createCardWatcher ─────────────────────────────────────────────────────────

describe('createCardWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flushObserver() {
    // MutationObserver callbacks run as microtasks in jsdom.
    await Promise.resolve();
    vi.advanceTimersByTime(60);
  }

  test('fires onChange when the card info changes', async () => {
    const el = addMetadata();
    const onChange = vi.fn();
    createCardWatcher(onChange);

    el.setAttribute('data-meta-info', JSON.stringify({ id: 807, type: 'vocab' }));
    await flushObserver();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('fires onChange when the submission count changes (repeated item)', async () => {
    const el = addMetadata();
    const onChange = vi.fn();
    createCardWatcher(onChange);

    el.setAttribute('data-meta-total-submissions-count', '1');
    await flushObserver();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('ignores unrelated attribute mutations', async () => {
    const el = addMetadata();
    const onChange = vi.fn();
    createCardWatcher(onChange);

    el.setAttribute('data-meta-is-correct', 'true');
    el.setAttribute('data-meta-hint-level', 'Hide');
    await flushObserver();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('does not fire when the metadata element disappears', async () => {
    const el = addMetadata();
    const onChange = vi.fn();
    createCardWatcher(onChange);

    el.remove();
    await flushObserver();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('fires when the metadata element is replaced with a new card', async () => {
    const el = addMetadata();
    const onChange = vi.fn();
    createCardWatcher(onChange);

    el.remove();
    addMetadata({ 'data-meta-info': JSON.stringify({ id: 900, type: 'grammar_point' }) });
    await flushObserver();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
