// BunPro adapter — mirrors the public API of wanikani.ts.
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

// The card's identity payload embedded in data-meta-info.
interface MetaInfo {
  id?: number | string;
  type?: string;
}

export interface BunproRevealContext {
  page: string;
  prompt: string | null;
  mode: 'reveal';
  revealed: boolean;
}

export interface BunproQuestionContext {
  page: string;
  prompt: string | null;
  category: string | null;
  type: string | null;
  postAttempt: boolean;
  meanings: string[];
  readings: string[];
  items: never[];
}

export type BunproContext = BunproRevealContext | BunproQuestionContext;

function getMetadata(): HTMLElement | null {
  return document.querySelector<HTMLElement>(Selectors.Metadata);
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('[kikoe] bunpro: failed to parse metadata JSON:', raw, err);
    return null;
  }
}

// data-meta-question-mode: 'cloze' answers in Japanese, 'translate' in English.
export function getLanguage(): string {
  const mode = getMetadata()?.dataset.metaQuestionMode;
  if (mode === 'cloze') return 'ja-JP';
  return 'en-US';
}

// Reveal & Grade cards have no text input — a reveal button before the
// answer is shown, then Good/Bad grade buttons after. Matched against both
// the title and visible text (whole words) the same way clickNext matches by
// title, since BunPro's class names churn but the labels are stable.
const RevealLabels = {
  reveal: ['show answer', 'reveal answer', 'reveal'],
  good: ['good'],
  bad: ['bad'],
};

function findLabeledButton(labels: string[]): HTMLButtonElement | null {
  for (const button of document.querySelectorAll('button')) {
    const haystack = `${button.title} ${button.textContent}`.toLowerCase();
    if (labels.some((label) => new RegExp(`\\b${label}\\b`).test(haystack))) return button;
  }
  return null;
}

function clickLabeledButton(labels: string[]): boolean {
  const button = findLabeledButton(labels);
  if (!button) return false;
  button.click();
  return true;
}

// Revealing is the "attempt" on a Reveal & Grade card, so
// data-meta-is-post-attempt flips once the answer is shown (the same flag
// bunpro_speed.ts keys results off). Fall back to the grade buttons'
// presence in case the flag is missing.
function isRevealed(meta: HTMLElement): boolean {
  if (meta.dataset.metaIsPostAttempt === 'true') return true;
  return !!(findLabeledButton(RevealLabels.good) && findLabeledButton(RevealLabels.bad));
}

function getPage(meta: HTMLElement): string {
  const loc = meta.dataset.metaLoc;
  if (loc === 'review') return 'review';
  if (loc === 'learn') return 'lesson';
  // Only 'review'/'learn' observed live; treat anything else (e.g. cram)
  // as a quiz so the listener still starts.
  return 'quiz';
}

// The card identity: item id plus submission count, so a repeated/ghost
// review of the same item later in the session still counts as a change.
function getCardKey(meta: HTMLElement): string | null {
  const info = parseJson(meta.dataset.metaInfo) as MetaInfo | null;
  if (info?.id == null) return null;
  return `${info.id}:${meta.dataset.metaTotalSubmissionsCount ?? '0'}`;
}

export function getContext(): BunproContext | null {
  const meta = getMetadata();
  if (!meta) return null;

  const page = getPage(meta);
  const prompt = getCardKey(meta);

  // Reveal & Grade decks have no input to type into — expose them as a
  // command-only mode (reveal / grade good / grade bad, see app.js) instead
  // of the checkAnswer path, carrying whether the answer is currently shown.
  if (meta.dataset.metaInputMode !== 'manual') {
    return { page, prompt, mode: 'reveal', revealed: isRevealed(meta) };
  }

  const questionMode = meta.dataset.metaQuestionMode;
  // cloze/translate map onto the existing checkAnswer types; any other mode
  // falls through to its generic "unknown question type" branch.
  let type = questionMode ?? null;
  if (questionMode === 'cloze') type = 'reading';
  if (questionMode === 'translate') type = 'meaning';

  const answers = (parseJson(meta.dataset.metaAnswersArray) as string[] | null) ?? [];
  const readings = type === 'reading' ? answers : [];
  const meanings = type === 'meaning' ? answers : [];
  const category = (parseJson(meta.dataset.metaInfo) as MetaInfo | null)?.type ?? null;

  const postAttempt = meta.dataset.metaIsPostAttempt === 'true';
  return { page, prompt, category, type, postAttempt, meanings, readings, items: [] };
}

// Structural type: reveal-mode contexts have no `type`, and app.js compares
// across both shapes during transitions.
type ContextIdentity = {
  prompt?: string | null;
  type?: string | null;
  mode?: string;
  postAttempt?: boolean;
} | null | undefined;

function itemKey(prompt: string | null | undefined): string | null | undefined {
  if (!prompt) return prompt;
  const separator = prompt.lastIndexOf(':');
  return separator === -1 ? prompt : prompt.slice(0, separator);
}

export function didContextChange(oldContext: ContextIdentity, newContext: ContextIdentity): boolean {
  const sameItemBeingGraded = newContext?.mode !== 'reveal' &&
    newContext?.postAttempt === true &&
    itemKey(newContext.prompt) === itemKey(oldContext?.prompt);
  const promptChanged = newContext?.prompt !== oldContext?.prompt;
  return (promptChanged && !sameItemBeingGraded) ||
         (newContext?.type !== oldContext?.type);
}

// BunPro's input is React-controlled: assigning .value directly is ignored
// because React tracks the value internally. Use the native setter, then
// dispatch a bubbling input event so React picks up the change.
export function inputAnswer(input: string): boolean {
  const el = document.querySelector<HTMLInputElement>(Selectors.Input);
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) return false;
  setter.call(el, input);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

export function submitAnswer(input: string): boolean {
  if (!inputAnswer(input)) return false;
  const button = document.querySelector<HTMLButtonElement>(Selectors.Submit);
  if (button) { button.click(); return true; }
  return false;
}

export function markWrong(): boolean {
  const incorrect = getLanguage() === 'en-US' ? 'aaa' : 'あああ';
  return submitAnswer(incorrect);
}

// Best-effort: only needed for accounts without BunPro's native Lightning
// Mode, which otherwise auto-advances on a correct answer.
export function clickNext(): boolean {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[title]')) {
    if (button.title.toLowerCase().includes('next question')) {
      button.click();
      return true;
    }
  }
  return false;
}

// Reveal & Grade actions — only meaningful when getContext() reported
// mode 'reveal'; each returns whether a matching button was found.
export function reveal(): boolean {
  return clickLabeledButton(RevealLabels.reveal);
}

export function gradeGood(): boolean {
  return clickLabeledButton(RevealLabels.good);
}

export function gradeBad(): boolean {
  return clickLabeledButton(RevealLabels.bad);
}

export function clickInfo(): void {
  const hint = document.querySelector<HTMLButtonElement>(Selectors.Hint);
  if (hint) hint.click();
}

// Fires onChange (debounced) when the current card's identity or question
// mode settles on a new value — not on every attribute mutation.
export function createCardWatcher(onChange: () => void): MutationObserver {
  function currentKey(): string | null {
    const meta = getMetadata();
    if (!meta) return null;
    return `${getCardKey(meta)}|${meta.dataset.metaQuestionMode}|${meta.dataset.metaInputMode}`;
  }

  let lastSeenKey = currentKey();
  let timer: ReturnType<typeof setTimeout> | undefined;

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
