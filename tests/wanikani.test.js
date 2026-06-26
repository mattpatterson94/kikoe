import {
  getPrompt, getLanguage, getContext,
  didContextChange, didAnswerCorrectly,
  getUserSynonyms, inputAnswer,
} from '../src/wanikani.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

// vi.stubGlobal('location', ...) replaces window.location, which is what
// our wanikani.js reads after we changed it from document.location.href.
function setURL(url) {
  vi.stubGlobal('location', { href: url });
}

function setDOM(html) {
  document.body.innerHTML = html;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function makeSubject(overrides = {}) {
  return {
    id: 440,
    object: 'kanji',
    data: {
      slug: '下',
      characters: '下',
      meanings: [{ meaning: 'Below', accepted_answer: true }],
      auxiliary_meanings: [{ meaning: 'Under', accepted_answer: true }],
      readings: [
        { reading: 'した', accepted_answer: true },
        { reading: 'しも', accepted_answer: false },
      ],
      ...overrides.data,
    },
    ...overrides,
  };
}

// ── getPrompt ─────────────────────────────────────────────────────────────────

describe('getPrompt', () => {
  test('reads text content from character-header element', () => {
    setDOM('<div class="character-header__characters">下</div>');
    expect(getPrompt()).toBe('下');
  });

  test('reads aria-label for radicals that have no text content', () => {
    setDOM('<div class="character-header__characters"><span aria-label="drop"></span></div>');
    expect(getPrompt()).toBe('drop');
  });

  test('returns null when prompt element is absent', () => {
    setDOM('');
    expect(getPrompt()).toBeNull();
  });
});

// ── getLanguage ───────────────────────────────────────────────────────────────

describe('getLanguage', () => {
  test('reading type → ja-JP', () => {
    setDOM('<span class="quiz-input__question-type">Reading</span>');
    expect(getLanguage()).toBe('ja-JP');
  });

  test('meaning type → en-US', () => {
    setDOM('<span class="quiz-input__question-type">Meaning</span>');
    expect(getLanguage()).toBe('en-US');
  });

  test('name type (radical) → en-US', () => {
    setDOM('<span class="quiz-input__question-type">Name</span>');
    expect(getLanguage()).toBe('en-US');
  });

  test('unknown type falls back to en-US', () => {
    setDOM('');
    expect(getLanguage()).toBe('en-US');
  });
});

// ── getContext ─────────────────────────────────────────────────────────────────

describe('getContext', () => {
  beforeEach(() => {
    setDOM(`
      <div class="character-header__characters">下</div>
      <span class="quiz-input__question-category">Kanji</span>
      <span class="quiz-input__question-type">Reading</span>
    `);
  });

  test('returns null when URL does not match a known page', () => {
    setURL('https://www.wanikani.com/dashboard');
    expect(getContext()).toBeNull();
  });

  test('review URL → page = "review"', () => {
    setURL('https://www.wanikani.com/subjects/review');
    expect(getContext([]).page).toBe('review');
  });

  test('returns correct prompt and type from DOM', () => {
    setURL('https://www.wanikani.com/subjects/review');
    const ctx = getContext([makeSubject()]);
    expect(ctx.prompt).toBe('下');
    expect(ctx.type).toBe('reading');
    expect(ctx.category).toBe('kanji');
  });

  test('populates accepted readings from matching subject', () => {
    setURL('https://www.wanikani.com/subjects/review');
    const ctx = getContext([makeSubject()]);
    expect(ctx.readings).toContain('した');
    expect(ctx.readings).not.toContain('しも'); // accepted_answer: false
  });

  test('populates meanings and auxiliary_meanings from matching subject', () => {
    setURL('https://www.wanikani.com/subjects/review');
    const ctx = getContext([makeSubject()]);
    expect(ctx.meanings).toContain('Below');
    expect(ctx.meanings).toContain('Under');
  });

  test('non-matching subject yields empty readings and meanings', () => {
    setURL('https://www.wanikani.com/subjects/review');
    const other = makeSubject({ data: { slug: '上', characters: '上' } });
    const ctx = getContext([other]);
    expect(ctx.readings).toStrictEqual([]);
    expect(ctx.meanings).toStrictEqual([]);
  });

  test('empty subjects array yields empty readings and meanings', () => {
    setURL('https://www.wanikani.com/subjects/review');
    const ctx = getContext([]);
    expect(ctx.readings).toStrictEqual([]);
    expect(ctx.meanings).toStrictEqual([]);
  });

  test('lesson URL → page = "lesson"', () => {
    setURL('https://www.wanikani.com/subjects/6259/lesson');
    expect(getContext([]).page).toBe('lesson');
  });

  test('quiz URL → page = "quiz"', () => {
    setURL('https://www.wanikani.com/subjects/lesson/quiz');
    expect(getContext([]).page).toBe('quiz');
  });

  test('extra_study URL → page = "quiz"', () => {
    setURL('https://www.wanikani.com/subjects/extra_study?queue_type=recent_lessons');
    expect(getContext([]).page).toBe('quiz');
  });

  test('recent-mistakes URL → page = "quiz"', () => {
    setURL('https://www.wanikani.com/recent-mistakes');
    expect(getContext([]).page).toBe('quiz');
  });
});

// ── didContextChange ──────────────────────────────────────────────────────────

describe('didContextChange', () => {
  const base = { prompt: '下', type: 'reading' };

  test('same prompt and type → no change', () => {
    expect(didContextChange(base, { ...base })).toBe(false);
  });

  test('different prompt → changed', () => {
    expect(didContextChange(base, { prompt: '上', type: 'reading' })).toBe(true);
  });

  test('different type → changed', () => {
    expect(didContextChange(base, { prompt: '下', type: 'meaning' })).toBe(true);
  });

  test('null old context → changed', () => {
    expect(didContextChange(null, base)).toBe(true);
  });

  test('null new context → changed', () => {
    expect(didContextChange(base, null)).toBe(true);
  });
});

// ── didAnswerCorrectly ────────────────────────────────────────────────────────

describe('didAnswerCorrectly', () => {
  test('action=pass → true', () => {
    expect(didAnswerCorrectly({ detail: { results: { action: 'pass' } } })).toBe(true);
  });

  test('action=fail → false', () => {
    expect(didAnswerCorrectly({ detail: { results: { action: 'fail' } } })).toBe(false);
  });

  test('malformed event (no results) → false', () => {
    expect(didAnswerCorrectly({ detail: {} })).toBe(false);
  });
});

// ── getUserSynonyms ───────────────────────────────────────────────────────────

// ── inputAnswer ───────────────────────────────────────────────────────────────

describe('inputAnswer', () => {
  test('sets #user-response value', () => {
    setDOM('<input id="user-response" type="text" />');
    inputAnswer('なんにち');
    expect(document.getElementById('user-response').value).toBe('なんにち');
  });

  test('does nothing when #user-response is absent', () => {
    setDOM('');
    expect(() => inputAnswer('なんにち')).not.toThrow();
  });
});

// ── getUserSynonyms ───────────────────────────────────────────────────────────

describe('getUserSynonyms', () => {
  // The selector is '#quiz-user-synonyms script' — a <script> child of that element.
  test('returns synonyms for a matching subject id', () => {
    const json = JSON.stringify({ 440: ['below', 'underneath'] });
    setDOM(`<div id="quiz-user-synonyms"><script type="application/json">${json}</script></div>`);
    expect(getUserSynonyms(440)).toStrictEqual(['below', 'underneath']);
  });

  test('returns empty array when id not in synonyms', () => {
    const json = JSON.stringify({ 440: ['below'] });
    setDOM(`<div id="quiz-user-synonyms"><script type="application/json">${json}</script></div>`);
    expect(getUserSynonyms(999)).toStrictEqual([]);
  });

  test('returns empty array when synonyms element is absent', () => {
    setDOM('');
    expect(getUserSynonyms(440)).toStrictEqual([]);
  });
});
