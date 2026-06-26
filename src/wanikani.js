import { isKana } from 'wanakana';

const Selectors = {
  EntryPrompt: 'span.page-header__icon.page-header__icon',
  Category: 'span.quiz-input__question-category',
  Type: 'span.quiz-input__question-type',
  Prompt: 'div.character-header__characters',
  Synonyms: '#quiz-user-synonyms script',
  Next: 'button.quiz-input__submit-button',
};

function getCategory() {
  const category = document.querySelector(Selectors.Category);
  if (category) return category.textContent.trim().toLowerCase();
  if (window.location.href.match('vocabulary')) return 'vocabulary';
  if (window.location.href.match('kanji')) return 'kanji';
  if (window.location.href.match('radicals')) return 'radical';
  return null;
}

function getType() {
  const type = document.querySelector(Selectors.Type);
  if (type) return type.textContent.trim().toLowerCase();
  if (window.location.href.match('#reading')) return 'reading';
  if (window.location.href.match('#meaning')) return 'meaning';
  if (window.location.href.match('vocabulary')) return 'reading';
  if (window.location.href.match('kanji')) return 'reading';
  if (window.location.href.match('radicals')) return 'name';
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

// Filters pre-fetched WaniKani API subjects for the current card.
// subjects: array of WaniKani API v2 subject objects
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

export function getUserSynonyms(id) {
  const script = document.querySelector(Selectors.Synonyms);
  if (script) {
    const data = JSON.parse(script.textContent);
    if (data[id]) return data[id];
  }
  return [];
}

// subjects: WaniKani API v2 subject objects for the current card (may be empty)
export function getContext(subjects = []) {
  let page = null;
  if (window.location.href.match('review')) page = 'review';
  if (window.location.href.match('lesson')) page = 'lesson';
  if (window.location.href.match('quiz')) page = 'quiz';
  if (window.location.href.match('recent-mistakes')) page = 'quiz';
  if (window.location.href.match('extra_study')) page = 'quiz';
  if (window.location.href.match('vocabulary|radicals|kanji')) page = 'entry';
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
  // WaniKani's quiz uses Stimulus.js which reads input.value directly on
  // submit, so setting the DOM property is sufficient.
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

export function didAnswerCorrectly(e) {
  if (typeof e.detail?.results?.action !== 'string') {
    console.error('[wkvi] didAnswerCorrectly: unexpected event shape', e);
    return false;
  }
  return e.detail.results.action === 'pass';
}
