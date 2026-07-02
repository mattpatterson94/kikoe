// BunPro adapter — mirrors the public API of wanikani.js.
//
// BunPro exposes a dedicated accessibility element for third-party review
// tools: #quiz-metadata-element carries the current card's state as
// data-meta-* attributes, including a JSON array of accepted answers. Unlike
// WaniKani, no API token or network fetch is needed — everything is in the DOM.

const Selectors = {
  Metadata: '#quiz-metadata-element',
  Input: '#js-manual-input',
  Submit: '.InputManual__button',
  Hint: 'button[title="Toggle the hint level"]',
};

function getMetadata() {
  return document.querySelector(Selectors.Metadata);
}

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('[wkvi] bunpro: failed to parse metadata JSON:', raw, err);
    return null;
  }
}

// data-meta-question-mode: 'cloze' answers in Japanese, 'translate' in English.
export function getLanguage() {
  const mode = getMetadata()?.dataset.metaQuestionMode;
  if (mode === 'cloze') return 'ja-JP';
  return 'en-US';
}

function getPage(meta) {
  const loc = meta.dataset.metaLoc;
  if (loc === 'review') return 'review';
  if (loc === 'learn') return 'lesson';
  // Only 'review'/'learn' observed live; treat anything else (e.g. cram)
  // as a quiz so the listener still starts.
  return 'quiz';
}

// The card identity: item id plus submission count, so a repeated/ghost
// review of the same item later in the session still counts as a change.
function getCardKey(meta) {
  const info = parseJson(meta.dataset.metaInfo);
  if (info?.id == null) return null;
  return `${info.id}:${meta.dataset.metaTotalSubmissionsCount ?? '0'}`;
}

export function getContext() {
  const meta = getMetadata();
  if (!meta) return null;

  const page = getPage(meta);
  const prompt = getCardKey(meta);

  // v1 only supports manual (text input) cards; Reveal & Grade decks have no
  // input to type into. Report a distinct mode so the UI can surface it.
  if (meta.dataset.metaInputMode !== 'manual') {
    return { page, prompt, mode: 'unsupported' };
  }

  const questionMode = meta.dataset.metaQuestionMode;
  // cloze/translate map onto the existing checkAnswer types; any other mode
  // falls through to its generic "unknown question type" branch.
  let type = questionMode;
  if (questionMode === 'cloze') type = 'reading';
  if (questionMode === 'translate') type = 'meaning';

  const answers = parseJson(meta.dataset.metaAnswersArray) ?? [];
  const readings = type === 'reading' ? answers : [];
  const meanings = type === 'meaning' ? answers : [];
  const category = parseJson(meta.dataset.metaInfo)?.type ?? null;

  return { page, prompt, category, type, meanings, readings, items: [] };
}

export function didContextChange(oldContext, newContext) {
  return (newContext?.prompt !== oldContext?.prompt) ||
         (newContext?.type !== oldContext?.type);
}

// BunPro's input is React-controlled: assigning .value directly is ignored
// because React tracks the value internally. Use the native setter, then
// dispatch a bubbling input event so React picks up the change.
export function inputAnswer(input) {
  const el = document.querySelector(Selectors.Input);
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, input);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

export function submitAnswer(input) {
  if (!inputAnswer(input)) return false;
  const button = document.querySelector(Selectors.Submit);
  if (button) { button.click(); return true; }
  return false;
}

export function markWrong() {
  const incorrect = getLanguage() === 'en-US' ? 'aaa' : 'あああ';
  submitAnswer(incorrect);
}

// Best-effort: only needed for accounts without BunPro's native Lightning
// Mode, which otherwise auto-advances on a correct answer.
export function clickNext() {
  for (const button of document.querySelectorAll('button[title]')) {
    if (button.title.toLowerCase().includes('next question')) {
      button.click();
      return true;
    }
  }
  return false;
}

export function clickInfo() {
  const hint = document.querySelector(Selectors.Hint);
  if (hint) hint.click();
}

// Fires onChange (debounced) when the current card's identity or question
// mode settles on a new value — not on every attribute mutation.
export function createCardWatcher(onChange) {
  function currentKey() {
    const meta = getMetadata();
    if (!meta) return null;
    return `${getCardKey(meta)}|${meta.dataset.metaQuestionMode}|${meta.dataset.metaInputMode}`;
  }

  let lastSeenKey = currentKey();
  let timer;

  const observer = new MutationObserver(() => {
    const key = currentKey();
    if (key === null || key === lastSeenKey) return;
    lastSeenKey = key;
    clearTimeout(timer);
    timer = setTimeout(onChange, 50);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'data-meta-info',
      'data-meta-total-submissions-count',
      'data-meta-question-mode',
      'data-meta-input-mode',
    ],
  });
  return observer;
}
