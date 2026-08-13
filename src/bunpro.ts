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
  // Legacy fallback for clickInfo — see InfoLabels.
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

// The graded card's "Show Info" button (alongside Undo / Alternatives), which
// is what speed_show_info opens on a wrong answer. Matched by label for the
// same reason as RevealLabels; only the stale title selector was used before,
// which matched nothing, so the setting silently did nothing on BunPro.
// 'item info' mirrors the WaniKani wording in case BunPro converges on it.
const InfoLabels = ['show info', 'item info'];

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

// The card Kikoe last submitted an answer for, so a graded card can be told
// apart from an untouched one carrying a stale post-attempt flag.
let lastSubmittedCardId: number | string | null = null;
let lastSubmittedAt = 0;

// How long a submission keeps its card pinned. What this guards against is a
// speech result for the utterance just submitted arriving late, which the
// engine emits about a second after the user stops talking — so the pin only
// has to outlive that. Letting it stand indefinitely instead would leave the
// item id claimed for the rest of the session, and ids repeat: a ghost review
// of the same item later could inherit the pin and have its answer dropped.
// The submission count can't stand in for a tighter identity here — grading is
// itself what increments it, so the card Kikoe answered never keeps the count
// it was answered at.
const SUBMISSION_PIN_MS = 5000;

// Whether writing to the input would land on a card Kikoe has already answered.
// Once BunPro grades, it shows its own answer reveal in that field, and writing
// there replaces the reveal with whatever Kikoe types. app.js's `submitted`
// flag already suppresses the ordinary paths; this is the structural backstop
// for anything that slips past it.
//
// Deliberately scoped to the card Kikoe itself answered rather than to
// data-meta-is-post-attempt alone: a fresh card that has not yet cleared the
// previous one's flag must still accept an answer, or a fast reply would be
// dropped outright, which is far worse than a clobbered reveal.
function isAlreadyAnswered(): boolean {
  if (lastSubmittedCardId === null) return false;
  if (Date.now() - lastSubmittedAt > SUBMISSION_PIN_MS) return false;
  const meta = getMetadata();
  if (meta?.dataset.metaIsPostAttempt !== 'true') return false;
  return currentCardId() === lastSubmittedCardId;
}

// BunPro's input is React-controlled: assigning .value directly is ignored
// because React tracks the value internally. Use the native setter, then
// dispatch a bubbling input event so React picks up the change.
export function inputAnswer(input: string): boolean {
  if (isAlreadyAnswered()) return false;
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
  if (!button) return false;
  // Snapshot before the click: it is synchronous, and BunPro's grade re-render
  // can land inside it and swap the metadata element out from under us.
  lastSubmittedCardId = currentCardId();
  lastSubmittedAt = Date.now();
  button.click();
  return true;
}

// The card markWrong() last submitted a placeholder answer for, so
// bunpro_speed.ts can tell Kikoe's own deliberate miss (ippatsu burning a
// shot, the "wrong" command) apart from a real answer BunPro happened to grade
// wrong. Pinned to the card rather than a bare boolean: a flag left unconsumed
// — the click never registered, the card advanced first — must not be read as
// a self-submitted miss on a later one.
let selfWrongCardId: number | string | null = null;

function currentCardId(): number | string | null {
  const meta = getMetadata();
  if (!meta) return null;
  return (parseJson(meta.dataset.metaInfo) as MetaInfo | null)?.id ?? null;
}

export function markWrong(): boolean {
  const incorrect = getLanguage() === 'en-US' ? 'aaa' : 'あああ';
  if (!submitAnswer(incorrect)) return false;
  // Reuse submitAnswer's pre-click snapshot rather than re-reading the DOM:
  // by now the click has already run BunPro's grading synchronously, so the
  // metadata element may have been re-rendered and currentCardId() can come
  // back null — which would silently drop the flag and never open item info.
  selfWrongCardId = lastSubmittedCardId;
  return true;
}

// Reads and clears in one go: the flag applies to the next result to land and
// nothing after it, whether or not that result turns out to be the matching
// card's.
export function takeSelfSubmittedWrongCardId(): number | string | null {
  const id = selfWrongCardId;
  selfWrongCardId = null;
  return id;
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

// Opening item info is idempotent by construction: once the panel is open
// BunPro's button reads "Hide Info", which no longer matches InfoLabels, so a
// repeat call can't toggle it back shut.
export function clickInfo(): void {
  if (clickLabeledButton(InfoLabels)) return;
  const hint = document.querySelector<HTMLButtonElement>(Selectors.Hint);
  if (hint) hint.click();
}

// The BunPro counterpart of wanikani.ts's canReadPage. BunPro's own class
// names churn (which is why the buttons are matched by label rather than
// class), but #quiz-metadata-element is the documented third-party surface,
// so its absence on a quiz page is the signal that something moved.
//
// A graded card is exempt: BunPro swaps the input out post-attempt, and
// there is nothing left to drive there anyway.
export function canReadPage(): boolean {
  const context = getContext();
  if (!context) return false;

  // 'mode' is what separates the two context shapes — only Reveal & Grade
  // cards carry it.
  if ('mode' in context) {
    return context.revealed
      ? !!(findLabeledButton(RevealLabels.good) && findLabeledButton(RevealLabels.bad))
      : !!findLabeledButton(RevealLabels.reveal);
  }

  if (context.postAttempt) return true;
  if (!context.prompt || !context.type) return false;
  return !!document.querySelector(Selectors.Input);
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
