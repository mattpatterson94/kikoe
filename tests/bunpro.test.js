import {
  getLanguage, getContext, didContextChange,
  inputAnswer, submitAnswer, markWrong, takeSelfSubmittedWrongCardId,
  clickNext, clickInfo,
  reveal, gradeGood, gradeBad,
  createCardWatcher, canReadPage,
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

  test('manual cards expose whether BunPro is grading the current attempt', () => {
    addMetadata({ 'data-meta-is-post-attempt': 'true' });
    expect(getContext().postAttempt).toBe(true);
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

  test('submission count changing while the same manual card is graded is not a new card', () => {
    expect(didContextChange(base, {
      prompt: '806:1', type: 'reading', postAttempt: true,
    })).toBe(false);
  });

  test('the same repeated item becomes a new card once its next attempt is ready', () => {
    expect(didContextChange(base, {
      prompt: '806:1', type: 'reading', postAttempt: false,
    })).toBe(true);
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
    expect(markWrong()).toBe(true);
    expect(input.value).toBe('あああ');
    expect(button.clicked).toBe(true);
  });

  test('submits an English non-answer for translate cards', () => {
    addMetadata({ 'data-meta-question-mode': 'translate' });
    const { input } = addInput();
    expect(markWrong()).toBe(true);
    expect(input.value).toBe('aaa');
  });
});

// ── writing to an already-answered card ───────────────────────────────────────

describe('inputAnswer on a graded card', () => {
  // lastSubmittedCardId is module state that outlives a test, so each case
  // needs its own instance to start from "Kikoe has answered nothing".
  let bunpro;
  beforeEach(async () => {
    vi.resetModules();
    bunpro = await import('../src/bunpro');
  });

  // BunPro shows its own answer reveal in the input once it grades; writing
  // there would replace that reveal with whatever Kikoe types.
  test('refuses to write over the reveal on a card Kikoe answered', () => {
    const meta = addMetadata();
    const { input } = addInput();
    expect(bunpro.submitAnswer('おとこ')).toBe(true);

    meta.setAttribute('data-meta-is-post-attempt', 'true');
    input.value = 'BunPro reveal';
    expect(bunpro.inputAnswer('おとこ')).toBe(false);
    expect(input.value).toBe('BunPro reveal');
  });

  // Dropping a real answer is worse than a clobbered reveal, so the guard only
  // covers the card Kikoe itself answered.
  test('still answers a fresh card carrying a stale post-attempt flag', () => {
    const meta = addMetadata();
    addInput();
    expect(bunpro.submitAnswer('おとこ')).toBe(true);

    meta.setAttribute('data-meta-info', JSON.stringify({ id: 807, type: 'vocab' }));
    meta.setAttribute('data-meta-is-post-attempt', 'true');
    expect(bunpro.inputAnswer('おんな')).toBe(true);
  });

  test('answers the same card again once BunPro re-asks it', () => {
    const meta = addMetadata();
    addInput();
    expect(bunpro.submitAnswer('おとこ')).toBe(true);
    meta.setAttribute('data-meta-is-post-attempt', 'true');

    // The repeat attempt clears the flag, and the card is answerable again.
    meta.setAttribute('data-meta-is-post-attempt', 'false');
    meta.setAttribute('data-meta-total-submissions-count', '1');
    expect(bunpro.inputAnswer('おとこ')).toBe(true);
  });

  test('does not block a card graded without Kikoe submitting anything', () => {
    addMetadata({ 'data-meta-is-post-attempt': 'true' });
    addInput();
    expect(bunpro.inputAnswer('おとこ')).toBe(true);
  });
});

// ── takeSelfSubmittedWrongCardId ──────────────────────────────────────────────

describe('takeSelfSubmittedWrongCardId', () => {
  // The flag is module state that outlives a single test, as it outlives a
  // single card in the page — drain whatever an earlier test left behind.
  beforeEach(() => { takeSelfSubmittedWrongCardId(); });

  test('is null until markWrong submits', () => {
    addMetadata();
    expect(takeSelfSubmittedWrongCardId()).toBeNull();
  });

  test('reports the card markWrong submitted for', () => {
    addMetadata();
    addInput();
    markWrong();
    expect(takeSelfSubmittedWrongCardId()).toBe(806);
  });

  test('clears after a single read', () => {
    addMetadata();
    addInput();
    markWrong();
    expect(takeSelfSubmittedWrongCardId()).toBe(806);
    expect(takeSelfSubmittedWrongCardId()).toBeNull();
  });

  // A miss the user typed themselves must stay indistinguishable from any
  // other card Kikoe never touched.
  test('stays null when markWrong could not submit', () => {
    addMetadata();
    // No input/button on the page, so the submission never lands.
    expect(markWrong()).toBe(false);
    expect(takeSelfSubmittedWrongCardId()).toBeNull();
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
  // The button a graded card actually renders, alongside Undo/Alternatives.
  test('clicks the "Show Info" button on a graded card', () => {
    const button = addButton('Show Info');
    clickInfo();
    expect(button.clicked).toBe(true);
  });

  test('leaves an already-open panel open rather than toggling it shut', () => {
    const button = addButton('Hide Info');
    clickInfo();
    expect(button.clicked).toBeUndefined();
  });

  test('falls back to the hint toggle button', () => {
    const button = document.createElement('button');
    button.title = 'Toggle the hint level';
    button.addEventListener('click', () => { button.clicked = true; });
    document.body.appendChild(button);
    clickInfo();
    expect(button.clicked).toBe(true);
  });

  test('prefers "Show Info" over the hint toggle when both exist', () => {
    const hint = document.createElement('button');
    hint.title = 'Toggle the hint level';
    hint.addEventListener('click', () => { hint.clicked = true; });
    document.body.appendChild(hint);
    const info = addButton('Show Info');
    clickInfo();
    expect(info.clicked).toBe(true);
    expect(hint.clicked).toBeUndefined();
  });

  test('does not throw when no info button is present', () => {
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

// ── canReadPage ───────────────────────────────────────────────────────────────

describe('canReadPage', () => {
  test('true when a manual-input card renders its metadata and input', () => {
    addMetadata();
    addInput();
    expect(canReadPage()).toBe(true);
  });

  // #quiz-metadata-element is the documented third-party surface; losing it
  // means every read below it returns nothing.
  test('false when the metadata element is absent', () => {
    addInput();
    expect(canReadPage()).toBe(false);
  });

  test('false when the manual input is missing', () => {
    addMetadata();
    expect(canReadPage()).toBe(false);
  });

  // BunPro swaps the input out once the card is graded, and there is nothing
  // left to drive at that point anyway.
  test('true for a graded card even without an input', () => {
    addMetadata({ 'data-meta-is-post-attempt': 'true' });
    expect(canReadPage()).toBe(true);
  });

  test('true on a Reveal & Grade card showing its reveal button', () => {
    addMetadata({ 'data-meta-input-mode': 'reveal' });
    addButton('Show Answer');
    expect(canReadPage()).toBe(true);
  });

  test('false on a Reveal & Grade card with no reveal button', () => {
    addMetadata({ 'data-meta-input-mode': 'reveal' });
    expect(canReadPage()).toBe(false);
  });

  test('true on a revealed card showing both grade buttons', () => {
    addMetadata({ 'data-meta-input-mode': 'reveal', 'data-meta-is-post-attempt': 'true' });
    addButton('Good');
    addButton('Bad');
    expect(canReadPage()).toBe(true);
  });

  test('false on a revealed card missing a grade button', () => {
    addMetadata({ 'data-meta-input-mode': 'reveal', 'data-meta-is-post-attempt': 'true' });
    addButton('Good');
    expect(canReadPage()).toBe(false);
  });
});
