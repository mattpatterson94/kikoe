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
  // Lessons moved from /subjects/lesson[/quiz] to /subject-lessons/<session>[/quiz]
  // in a WaniKani URL revamp; match both so older paths keep working.
  LessonQuiz: /^(\/subjects\/lesson\/quiz|\/subject-lessons\/[^/]+\/quiz)(\/|$)/,
  Lesson: /^(\/subjects\/(\d+\/)?lesson|\/subject-lessons)(\/|$)/,
  ExtraStudy: /^\/subjects\/extra_study(\/|$)/,
  RecentMistakes: /^\/recent-mistakes(\/|$)/,
  Vocabulary: /^\/vocabulary\//,
  Kanji: /^\/kanji\//,
  Radicals: /^\/radicals\//,
};

// WaniKani API v2 subject, narrowed to the fields this adapter reads.
// Fields stay optional because subjects arrive from the page context and
// older cached shapes have varied.
export interface WanikaniSubject {
  id: number;
  object: string;
  data: {
    slug?: string;
    characters?: string | null;
    meanings?: { meaning: string; accepted_answer: boolean }[];
    auxiliary_meanings?: { meaning: string; accepted_answer: boolean }[];
    readings?: { reading: string; accepted_answer: boolean }[];
  };
}

export type WanikaniPage = 'review' | 'quiz' | 'lesson' | 'entry';

export interface WanikaniContext {
  page: WanikaniPage;
  prompt: string | null;
  category: string | null;
  type: string | null;
  meanings: string[];
  readings: string[];
  items: WanikaniSubject[];
}

function getCategory(): string | null {
  const category = document.querySelector(Selectors.Category);
  if (category) return (category.textContent ?? '').trim().toLowerCase();
  const pathname = window.location.pathname;
  if (PathPatterns.Vocabulary.test(pathname)) return 'vocabulary';
  if (PathPatterns.Kanji.test(pathname)) return 'kanji';
  if (PathPatterns.Radicals.test(pathname)) return 'radical';
  return null;
}

function getType(): string | null {
  const type = document.querySelector(Selectors.Type);
  if (type) return (type.textContent ?? '').trim().toLowerCase();
  const pathname = window.location.pathname;
  if (window.location.hash === '#reading') return 'reading';
  if (window.location.hash === '#meaning') return 'meaning';
  if (PathPatterns.Vocabulary.test(pathname)) return 'reading';
  if (PathPatterns.Kanji.test(pathname)) return 'reading';
  if (PathPatterns.Radicals.test(pathname)) return 'name';
  return null;
}

export function getLanguage(): string {
  const t = getType();
  if (t === 'meaning' || t === 'name') return 'en-US';
  if (t === 'reading') return 'ja-JP';
  return 'en-US';
}

function getPromptFromEntry(): string | null {
  const el = document.querySelector(Selectors.EntryPrompt);
  if (!el) return null;
  const prompt = el.textContent;
  return prompt === '' ? null : prompt;
}

// Image-only radicals (e.g. "Rib Cage") render no text — their name only
// exists in a descendant's aria-label, so a raw textContent read comes back
// empty (or whitespace-only) for them.
function readPromptText(el: Element): string | null {
  const prompt = (el.textContent ?? '').trim();
  if (prompt !== '') return prompt;
  const label = el.querySelector('[aria-label]')?.getAttribute('aria-label')?.trim();
  return label ? label.toLowerCase() : null;
}

export function getPrompt(): string | null {
  const el = document.querySelector(Selectors.Prompt);
  if (!el) return getPromptFromEntry();
  return readPromptText(el);
}

export function getUserSynonyms(id: number): string[] {
  const script = document.querySelector(Selectors.Synonyms);
  if (script) {
    const data = JSON.parse(script.textContent ?? '') as Record<string, string[]>;
    if (data[id]) return data[id];
  }
  return [];
}

// Image-only radicals display a space-separated name ("rib cage") while the
// API slug is hyphenated ("rib-cage") — same bridge as matchRadical in the
// content script's fetch path.
function getItems(subjects: WanikaniSubject[], category: string | null, slug: string | null): WanikaniSubject[] {
  const hyphenated = slug?.replace(/\s+/g, '-');
  return subjects.filter(s =>
    s.object === category &&
    (s.data.slug === slug || s.data.characters === slug || s.data.slug === hyphenated)
  );
}

function getMeaningsFromItems(items: WanikaniSubject[]): string[] {
  const meanings: string[] = [];
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

function getReadingsFromItems(items: WanikaniSubject[]): string[] {
  const readings: string[] = [];
  for (const item of items) {
    if (item?.data?.readings) {
      readings.push(...item.data.readings.filter(r => r.accepted_answer).map(r => r.reading));
    }
  }
  return readings;
}

// subjects: WaniKani API v2 subject objects for the current card (may be empty)
export function getContext(subjects: WanikaniSubject[] = []): WanikaniContext | null {
  const pathname = window.location.pathname;
  let page: WanikaniPage | null = null;
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
  if (category === 'vocabulary' && isKana(prompt ?? '')) category = 'kana_vocabulary';
  const type = getType();

  const items = getItems(subjects, category, prompt);
  const readings = getReadingsFromItems(items);
  const meanings = getMeaningsFromItems(items);
  for (const item of items) {
    meanings.push(...getUserSynonyms(item.id));
  }

  return { page, prompt, category, type, meanings, readings, items };
}

// Structural type instead of WanikaniContext so the same helper works for
// any context-ish value app.js hands it during transitions.
type ContextIdentity = { prompt?: string | null; type?: string | null } | null | undefined;

export function didContextChange(oldContext: ContextIdentity, newContext: ContextIdentity): boolean {
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

function extractSubjectIds(node: unknown, key: string | null = null, depth = 0): number[] | null {
  if (depth > 6 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    if (node.length && node.every(Number.isInteger) && (key === null || SUBJECT_ID_KEY_RE.test(key))) {
      return node as number[];
    }
    if (node.length && node.every(n => n && typeof n === 'object' && Number.isInteger((n as { subject_id?: unknown }).subject_id))) {
      return node.map(n => (n as { subject_id: number }).subject_id);
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

// Upcoming subject IDs for the current session, in queue order. Returns the
// whole queue — slicing it into API-sized batches happens on the
// content-script side, which owns the already-requested bookkeeping. The cap
// only guards against extractSubjectIds misidentifying some giant unrelated
// integer array, and sits well above any real session length.
export function getQueuedSubjectIds(cap = 1000): number[] {
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const ids = extractSubjectIds(data);
    if (ids?.length) return ids.slice(0, cap);
  }
  return [];
}

export function clickNext(): boolean {
  const button = document.querySelector<HTMLButtonElement>(Selectors.Next);
  if (button) { button.click(); return true; }
  return false;
}

export function markWrong(): void {
  const incorrect = getLanguage() === 'en-US' ? 'aaa' : 'あああ';
  submitAnswer(incorrect);
}

export function inputAnswer(input: string): void {
  const userResponse = document.querySelector<HTMLInputElement>('#user-response');
  if (!userResponse) return;
  userResponse.value = input;
}

export function submitAnswer(input: string): boolean {
  inputAnswer(input);
  return clickNext();
}

function isNotAlreadyOpen(): boolean {
  const info = document.getElementById('information');
  if (!info) return true;
  return !Array.from(info.classList).some(c => c.includes('open'));
}

export function clickInfo(): void {
  for (const item of document.querySelectorAll<HTMLAnchorElement>('#additional-content a')) {
    if ((item.textContent ?? '').includes('Item Info')) {
      if (isNotAlreadyOpen()) item.click();
      return;
    }
  }
}

// Fires onChange (debounced) only when the prompt+type DOM elements settle on
// new values. This ignores unrelated mutations (animations, the `correct`
// attribute, progress bars) that would otherwise reset a naive debounce and
// prevent onChange from ever firing.
export function createCardWatcher(onChange: () => void): MutationObserver {
  // Same aria-label-aware read as getPrompt — a raw textContent read is empty
  // for image-only radicals, which made the watcher treat every mutation as a
  // transitional state and never fire onChange for those cards.
  function watchedPrompt(): string | null {
    const el = document.querySelector(Selectors.Prompt);
    return el ? readPromptText(el) : null;
  }

  let lastSeenPrompt = watchedPrompt();
  let lastSeenType = document.querySelector(Selectors.Type)?.textContent?.trim().toLowerCase();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const observer = new MutationObserver(() => {
    const prompt = watchedPrompt();
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

export function didAnswerCorrectly(e: { detail?: { results?: { action?: unknown } } }): boolean {
  if (typeof e.detail?.results?.action !== 'string') {
    console.error('[kikoe] didAnswerCorrectly: unexpected event shape', e);
    return false;
  }
  return e.detail.results.action === 'pass';
}
