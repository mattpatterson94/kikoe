import { isKana } from 'wanakana';

const Selectors = {
  EntryPrompt: 'span.page-header__icon.page-header__icon',
  Category: 'span.quiz-input__question-category',
  Type: 'span.quiz-input__question-type',
  Prompt: 'div.character-header__characters',
  Synonyms: '#quiz-user-synonyms script',
  Next: 'button.quiz-input__submit-button',
};

// Path segment matchers, anchored so lookalikes (e.g. "/preview", a
// "vocabulary" query param, a future "/reviews-dashboard" page) don't
// false-positive the way a bare href substring match would.
const PathPatterns = {
  Review: /^\/subjects\/review(\/|$)/,
  LessonQuiz: /^\/subjects\/lesson\/quiz(\/|$)/,
  Lesson: /^\/subjects\/(\d+\/)?lesson(\/|$)/,
  ExtraStudy: /^\/subjects\/extra_study(\/|$)/,
  RecentMistakes: /^\/recent-mistakes(\/|$)/,
  Vocabulary: /^\/vocabulary\//,
  Kanji: /^\/kanji\//,
  Radicals: /^\/radicals\//,
};

function getCategory() {
  const category = document.querySelector(Selectors.Category);
  if (category) return category.textContent.trim().toLowerCase();
  const pathname = window.location.pathname;
  if (PathPatterns.Vocabulary.test(pathname)) return 'vocabulary';
  if (PathPatterns.Kanji.test(pathname)) return 'kanji';
  if (PathPatterns.Radicals.test(pathname)) return 'radical';
  return null;
}

function getType() {
  const type = document.querySelector(Selectors.Type);
  if (type) return type.textContent.trim().toLowerCase();
  const pathname = window.location.pathname;
  if (window.location.hash === '#reading') return 'reading';
  if (window.location.hash === '#meaning') return 'meaning';
  if (PathPatterns.Vocabulary.test(pathname)) return 'reading';
  if (PathPatterns.Kanji.test(pathname)) return 'reading';
  if (PathPatterns.Radicals.test(pathname)) return 'name';
  return null;
}

export function getLanguage() {
  const t = getType();
  if (t === 'meaning' || t === 'name') return 'en-US';
  if (t === 'reading') return 'ja-JP';
  return 'en-US';
}

function getPromptFromEntry() {
  const el = document.querySelector(Selectors.EntryPrompt);
  if (!el) return null;
  const prompt = el.textContent;
  return prompt === '' ? null : prompt;
}

export function getPrompt() {
  const el = document.querySelector(Selectors.Prompt);
  if (!el) return getPromptFromEntry();
  let prompt = el.textContent;
  if (prompt === '' && el.childNodes.length > 0 && el.childNodes[0].getAttribute('aria-label')) {
    prompt = el.childNodes[0].getAttribute('aria-label').toLowerCase();
  }
  return prompt === '' ? null : prompt;
}

export function getUserSynonyms(id) {
  const script = document.querySelector(Selectors.Synonyms);
  if (script) {
    const data = JSON.parse(script.textContent);
    if (data[id]) return data[id];
  }
  return [];
}

function getItems(subjects, category, slug) {
  return subjects.filter(s =>
    s.object === category &&
    (s.data.slug === slug || s.data.characters === slug)
  );
}

function getMeaningsFromItems(items) {
  const meanings = [];
  for (const item of items) {
    if (item?.data?.meanings) {
      meanings.push(...item.data.meanings.filter(m => m.accepted_answer).map(m => m.meaning));
    }
    if (item?.data?.auxiliary_meanings) {
      meanings.push(...item.data.auxiliary_meanings.filter(m => m.accepted_answer).map(m => m.meaning));
    }
  }
  return meanings;
}

function getReadingsFromItems(items) {
  const readings = [];
  for (const item of items) {
    if (item?.data?.readings) {
      readings.push(...item.data.readings.filter(r => r.accepted_answer).map(r => r.reading));
    }
  }
  return readings;
}

// subjects: WaniKani API v2 subject objects for the current card (may be empty)
export function getContext(subjects = []) {
  const pathname = window.location.pathname;
  let page = null;
  if (PathPatterns.Review.test(pathname)) page = 'review';
  if (PathPatterns.LessonQuiz.test(pathname)) page = 'quiz';
  else if (PathPatterns.Lesson.test(pathname)) page = 'lesson';
  if (PathPatterns.ExtraStudy.test(pathname)) page = 'quiz';
  if (PathPatterns.RecentMistakes.test(pathname)) page = 'quiz';
  if (
    PathPatterns.Vocabulary.test(pathname) ||
    PathPatterns.Radicals.test(pathname) ||
    PathPatterns.Kanji.test(pathname)
  ) page = 'entry';
  if (!page) return null;

  const prompt = getPrompt();
  let category = getCategory();
  if (category === 'vocabulary' && isKana(prompt)) category = 'kana_vocabulary';
  const type = getType();

  const items = getItems(subjects, category, prompt);
  const readings = getReadingsFromItems(items);
  const meanings = getMeaningsFromItems(items);
  for (const item of items) {
    meanings.push(...getUserSynonyms(item.id));
  }

  return { page, prompt, category, type, meanings, readings, items };
}

export function didContextChange(oldContext, newContext) {
  return (newContext?.prompt !== oldContext?.prompt) ||
         (newContext?.type !== oldContext?.type);
}

// The review/lesson queue is embedded as JSON in a <script> tag so the SPA
// can resume without an extra API round-trip. The container differs by page
// and has changed shape before, so scan every embedded JSON blob for a
// subject-id-shaped array rather than pinning one selector — pages without a
// recognizable queue (e.g. extra_study) simply yield no prefetch, and the
// existing per-card fetch remains the fallback.
const SUBJECT_ID_KEY_RE = /subject.*id/i;

function extractSubjectIds(node, key = null, depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    if (node.length && node.every(Number.isInteger) && (key === null || SUBJECT_ID_KEY_RE.test(key))) {
      return node;
    }
    if (node.length && node.every(n => n && typeof n === 'object' && Number.isInteger(n.subject_id))) {
      return node.map(n => n.subject_id);
    }
    for (const item of node) {
      const found = extractSubjectIds(item, null, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [k, value] of Object.entries(node)) {
    const found = extractSubjectIds(value, k, depth + 1);
    if (found) return found;
  }
  return null;
}

// Upcoming subject IDs for the current session, in queue order.
export function getQueuedSubjectIds(limit = 50) {
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    let data;
    try {
      data = JSON.parse(script.textContent);
    } catch {
      continue;
    }
    const ids = extractSubjectIds(data);
    if (ids?.length) return ids.slice(0, limit);
  }
  return [];
}

export function clickNext() {
  const button = document.querySelector(Selectors.Next);
  if (button) { button.click(); return true; }
  return false;
}

export function markWrong() {
  const incorrect = getLanguage() === 'en-US' ? 'aaa' : 'あああ';
  submitAnswer(incorrect);
}

export function inputAnswer(input) {
  const userResponse = document.querySelector('#user-response');
  if (!userResponse) return;
  userResponse.value = input;
}

export function submitAnswer(input) {
  inputAnswer(input);
  return clickNext();
}

function isNotAlreadyOpen() {
  const info = document.getElementById('information');
  if (!info) return true;
  return !Array.from(info.classList).some(c => c.includes('open'));
}

export function clickInfo() {
  for (const item of document.querySelectorAll('#additional-content a')) {
    if (item.textContent.includes('Item Info')) {
      if (isNotAlreadyOpen()) item.click();
      return;
    }
  }
}

// Fires onChange (debounced) only when the prompt+type DOM elements settle on
// new values. This ignores unrelated mutations (animations, the `correct`
// attribute, progress bars) that would otherwise reset a naive debounce and
// prevent onChange from ever firing.
export function createCardWatcher(onChange) {
  let lastSeenPrompt = document.querySelector(Selectors.Prompt)?.textContent?.trim();
  let lastSeenType = document.querySelector(Selectors.Type)?.textContent?.trim().toLowerCase();
  let timer;

  const observer = new MutationObserver(() => {
    const prompt = document.querySelector(Selectors.Prompt)?.textContent?.trim();
    const type = document.querySelector(Selectors.Type)?.textContent?.trim().toLowerCase();
    if (!prompt || !type) return;
    if (prompt === lastSeenPrompt && type === lastSeenType) return;
    lastSeenPrompt = prompt;
    lastSeenType = type;
    clearTimeout(timer);
    timer = setTimeout(onChange, 50);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}

export function didAnswerCorrectly(e) {
  if (typeof e.detail?.results?.action !== 'string') {
    console.error('[kikoe] didAnswerCorrectly: unexpected event shape', e);
    return false;
  }
  return e.detail.results.action === 'pass';
}
