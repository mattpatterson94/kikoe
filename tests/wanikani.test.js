import {
  getPrompt, getLanguage, getContext,
  didContextChange, didAnswerCorrectly,
  getUserSynonyms, inputAnswer, createCardWatcher,
  getQueuedSubjectIds,
} from '../src/wanikani';


// ── Helpers ───────────────────────────────────────────────────────────────────

// vi.stubGlobal('location', ...) replaces window.location, which is what
// our wanikani.js reads after we changed it from document.location.href.
// wanikani.js matches against pathname/hash (not the full href), so derive
// those from the URL the same way a real Location object would.
function setURL(url) {
  const parsed = new URL(url);
  vi.stubGlobal('location', {
    href: url,
    pathname: parsed.pathname,
    hash: parsed.hash,
    search: parsed.search,
  });
}

function setDOM(html) {
  document.body.innerHTML = html;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

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
    expect(getContext().page).toBe('review');
  });

  test('returns correct prompt, type, and category from DOM', () => {
    setURL('https://www.wanikani.com/subjects/review');
    const ctx = getContext();
    expect(ctx.prompt).toBe('下');
    expect(ctx.type).toBe('reading');
    expect(ctx.category).toBe('kanji');
  });

  test('returns empty meanings and readings when no subjects provided', () => {
    setURL('https://www.wanikani.com/subjects/review');
    const ctx = getContext([]);
    expect(ctx.meanings).toEqual([]);
    expect(ctx.readings).toEqual([]);
    expect(ctx.items).toEqual([]);
  });

  test('extracts accepted meanings from matching subjects', () => {
    setURL('https://www.wanikani.com/subjects/review');
    const subjects = [{
      id: 1, object: 'kanji',
      data: {
        slug: '下', characters: '下',
        meanings: [
          { meaning: 'Below', accepted_answer: true },
          { meaning: 'Under', accepted_answer: true },
          { meaning: 'Beneath', accepted_answer: false },
        ],
        auxiliary_meanings: [],
      }
    }];
    const ctx = getContext(subjects);
    expect(ctx.meanings).toContain('Below');
    expect(ctx.meanings).toContain('Under');
    expect(ctx.meanings).not.toContain('Beneath');
  });

  // The aria-label fallback must survive formatting whitespace around the
  // image element — a raw `textContent === ''` check breaks the moment
  // WaniKani renders the child indented on its own line.
  test('image-only radical prompt survives surrounding whitespace', () => {
    setURL('https://www.wanikani.com/subjects/review');
    setDOM(`
      <div class="character-header__characters">
        <wk-character-image aria-label="Rib Cage"></wk-character-image>
      </div>
      <span class="quiz-input__question-category">Radical</span>
      <span class="quiz-input__question-type">Name</span>
    `);
    expect(getPrompt()).toBe('rib cage');
  });

  // Image-only radicals show their space-separated name via aria-label
  // ("rib cage"), but the API subject's slug is hyphenated ("rib-cage") and
  // characters is null — the matcher must bridge that gap.
  test('matches an image-only radical whose slug is hyphenated', () => {
    setURL('https://www.wanikani.com/subjects/review');
    setDOM(`
      <div class="character-header__characters"><wk-character-image aria-label="Rib Cage"></wk-character-image></div>
      <span class="quiz-input__question-category">Radical</span>
      <span class="quiz-input__question-type">Name</span>
    `);
    const subjects = [{
      id: 9452, object: 'radical',
      data: {
        slug: 'rib-cage', characters: null,
        meanings: [{ meaning: 'Rib Cage', accepted_answer: true }],
        auxiliary_meanings: [
          { meaning: 'Ribcage', accepted_answer: true },
          { meaning: 'Ribs', accepted_answer: true },
        ],
      }
    }];
    const ctx = getContext(subjects);
    expect(ctx.prompt).toBe('rib cage');
    expect(ctx.meanings).toContain('Rib Cage');
    expect(ctx.meanings).toContain('Ribcage');
  });

  test('lesson URL → page = "lesson"', () => {
    setURL('https://www.wanikani.com/subjects/6259/lesson');
    expect(getContext().page).toBe('lesson');
  });

  test('quiz URL → page = "quiz"', () => {
    setURL('https://www.wanikani.com/subjects/lesson/quiz');
    expect(getContext().page).toBe('quiz');
  });

  test('extra_study URL → page = "quiz"', () => {
    setURL('https://www.wanikani.com/subjects/extra_study?queue_type=recent_lessons');
    expect(getContext().page).toBe('quiz');
  });

  test('recent-mistakes URL → page = "quiz"', () => {
    setURL('https://www.wanikani.com/recent-mistakes');
    expect(getContext().page).toBe('quiz');
  });

  test('URL containing "review" as a substring but not the review path → not review', () => {
    setURL('https://www.wanikani.com/subjects/preview');
    expect(getContext()).toBeNull();
  });

  test('URL with "review" in the query string only → not review', () => {
    setURL('https://www.wanikani.com/level/12?ref=review-page');
    expect(getContext()).toBeNull();
  });

  test('lesson/quiz URL is classified as quiz, not lesson', () => {
    setURL('https://www.wanikani.com/subjects/lesson/quiz');
    expect(getContext().page).toBe('quiz');
  });

  test('path merely containing "lesson" (not the lesson path) does not match', () => {
    setURL('https://www.wanikani.com/settings/lessons-preferences');
    expect(getContext()).toBeNull();
  });

  test('path merely containing "extra_study" as a prefix of another segment does not match', () => {
    setURL('https://www.wanikani.com/subjects/extra_study_archive');
    expect(getContext()).toBeNull();
  });
});

describe('getContext entry page category/type fallback', () => {
  test('vocabulary entry page → category and type derived from path', () => {
    setDOM('');
    setURL('https://www.wanikani.com/vocabulary/%E4%B8%8A%E6%89%8B');
    const ctx = getContext();
    expect(ctx.page).toBe('entry');
    expect(ctx.category).toBe('vocabulary');
    expect(ctx.type).toBe('reading');
  });

  test('"vocabulary" appearing only in the query string does not trigger entry detection', () => {
    setDOM('');
    setURL('https://www.wanikani.com/dashboard?ref=vocabulary-list');
    expect(getContext()).toBeNull();
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

describe('createCardWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setCard(prompt, type) {
    setDOM(`
      <div class="character-header__characters">${prompt}</div>
      <span class="quiz-input__question-type">${type}</span>
    `);
  }

  async function flushObserver() {
    await Promise.resolve();
    vi.advanceTimersByTime(60);
  }

  test('fires onChange when the prompt settles on a new value', async () => {
    setCard('下', 'Reading');
    const onChange = vi.fn();
    createCardWatcher(onChange);

    setCard('上', 'Reading');
    await flushObserver();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('fires onChange when only the type changes', async () => {
    setCard('下', 'Reading');
    const onChange = vi.fn();
    createCardWatcher(onChange);

    setCard('下', 'Meaning');
    await flushObserver();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('ignores mutations that leave prompt and type unchanged', async () => {
    setCard('下', 'Reading');
    const onChange = vi.fn();
    createCardWatcher(onChange);

    document.body.appendChild(document.createElement('div'));
    await flushObserver();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('ignores transitional states where prompt or type is missing', async () => {
    setCard('下', 'Reading');
    const onChange = vi.fn();
    createCardWatcher(onChange);

    setDOM('');
    await flushObserver();
    expect(onChange).not.toHaveBeenCalled();
  });

  // Image-only radicals (e.g. "Rib Cage") have an empty textContent — the
  // name only exists in the child's aria-label, same fallback getPrompt uses.
  function setImageRadicalCard(name, type) {
    setDOM(`
      <div class="character-header__characters"><wk-character-image aria-label="${name}"></wk-character-image></div>
      <span class="quiz-input__question-type">${type}</span>
    `);
  }

  test('fires onChange when the card changes to an image-only radical', async () => {
    setCard('下', 'Reading');
    const onChange = vi.fn();
    createCardWatcher(onChange);

    setImageRadicalCard('Rib Cage', 'Name');
    await flushObserver();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('fires onChange when the card changes away from an image-only radical', async () => {
    setImageRadicalCard('Rib Cage', 'Name');
    const onChange = vi.fn();
    createCardWatcher(onChange);

    setCard('下', 'Reading');
    await flushObserver();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('ignores mutations that leave an image-only radical card unchanged', async () => {
    setImageRadicalCard('Rib Cage', 'Name');
    const onChange = vi.fn();
    createCardWatcher(onChange);

    document.body.appendChild(document.createElement('div'));
    await flushObserver();
    expect(onChange).not.toHaveBeenCalled();
  });
});

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

describe('getQueuedSubjectIds', () => {
  function setQueueJSON(value) {
    setDOM(`<script type="application/json">${JSON.stringify(value)}</script>`);
  }

  test('returns a bare top-level array of subject ids', () => {
    setQueueJSON([440, 441, 442]);
    expect(getQueuedSubjectIds()).toEqual([440, 441, 442]);
  });

  test('finds an array nested under a subject_ids-like key', () => {
    setQueueJSON({ queue: { subject_ids: [1, 2, 3] } });
    expect(getQueuedSubjectIds()).toEqual([1, 2, 3]);
  });

  test('extracts ids from an array of queue entry objects', () => {
    setQueueJSON([
      { subject_id: 10, srs_stage: 1 },
      { subject_id: 20, srs_stage: 4 },
    ]);
    expect(getQueuedSubjectIds()).toEqual([10, 20]);
  });

  test('ignores unrelated integer arrays not under a subject-id key', () => {
    setQueueJSON({ levels: [1, 2, 3], subjectIds: [55, 66] });
    expect(getQueuedSubjectIds()).toEqual([55, 66]);
  });

  test('skips malformed JSON and checks the next script tag', () => {
    setDOM(
      '<script type="application/json">not json</script>' +
      '<script type="application/json">[7, 8, 9]</script>'
    );
    expect(getQueuedSubjectIds()).toEqual([7, 8, 9]);
  });

  test('returns the full queue past 50 items — batching is the content script\'s job', () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    setQueueJSON(ids);
    expect(getQueuedSubjectIds()).toEqual(ids);
  });

  test('caps pathologically large arrays', () => {
    setQueueJSON([1, 2, 3, 4, 5]);
    expect(getQueuedSubjectIds(2)).toEqual([1, 2]);
  });

  test('returns empty array when no recognizable queue is present', () => {
    setQueueJSON({ foo: 'bar' });
    expect(getQueuedSubjectIds()).toEqual([]);
  });

  test('returns empty array when there is no embedded JSON at all', () => {
    setDOM('');
    expect(getQueuedSubjectIds()).toEqual([]);
  });
});
