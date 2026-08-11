import { checkAnswer } from './flashcards';
import type { CheckResult } from './flashcards';
import { createRecognition, setLanguage } from './recognition';
import * as wanikani from './wanikani';
import * as bunpro from './bunpro';
import { detectSite } from './site';
import { initSettings, updateSettings, getSettings, decodeConfig } from './settings';
import type { Settings } from './settings';
import { debugLog } from './logger';
import { startSpeedEnhancer as startWanikaniSpeedEnhancer } from './speed';
import { startSpeedEnhancer as startBunproSpeedEnhancer } from './bunpro_speed';
import { createTranscriptContainer, logTranscript, showIdleIndicator, setIdleIndicatorState } from './live_transcript';
import { SHARED_COMMANDS, REVEAL_COMMANDS, GRADE_COMMANDS, HELP_COMMANDS, buildCommandTable, commandsForMode } from './commands';
import type { HelpMode } from './commands';
import { updateHelpChip, openHelpPanel, closeHelpPanel, isHelpPanelOpen, showHelpHint } from './help';
import type { HelpView } from './help';
import { loadDictionary } from './dict';
import type { Dictionary } from './dict';
import type { WanikaniSubject } from './wanikani';

import { ToHiragana } from './candidates/to_hiragana';
import { ConvertWo } from './candidates/convert_wo';
import { BasicDictionary } from './candidates/basic_dictionary';
import { SplitDictionary } from './candidates/split_dictionary';
import { CompoundDictionary } from './candidates/compound_dictionary';
import { SuruVerbs } from './candidates/suru_verbs';
import { RepeatingSubstring } from './candidates/repeating';
import { MultipleWords } from './candidates/multiple';
import { Numerals } from './candidates/numerals';

const EMPTY_FINAL_RESTART_THRESHOLD = 3;
const RESTARTING_INDICATOR_MS = 900;
const MATCHED_INTERIM_SUBMIT_MS = 900;

// window blur/focus exist as page-activity signals for the desktop case
// visibilitychange misses: alt-tabbing to another app while the browser
// window (and this tab) stays visible on screen. Touch-primary devices have
// no such state — backgrounding is always a real visibilitychange there —
// but dismissing the on-screen keyboard blurs whatever input triggered it,
// which some of these browsers report as the window itself losing focus.
// That falsely paused recognition every time the keyboard was dismissed
// (see https://github.com/mattpatterson94/kikoe/issues/79), so blur is only
// trusted as "the user left" on devices where a mouse/trackpad is primary.
function isTouchPrimaryDevice(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

// Maps a SpeechRecognition error type to the idle-indicator state that
// explains it to the user. Errors with no entry here (e.g. 'aborted') keep
// whatever indicator state is already showing — recognition.ts still logs them.
const RECOGNITION_ERROR_STATES: Partial<Record<SpeechRecognitionErrorCode, string>> = {
  'not-allowed': 'mic-denied',
  'service-not-allowed': 'mic-denied',
  'audio-capture': 'no-mic',
  'network': 'reconnecting',
};

// Structural supertype of WanikaniContext and BunproContext — app code only
// ever reads these fields, always defensively, since either adapter (or a
// transitional DOM state) may omit them.
interface SiteContext {
  page: string;
  prompt: string | null;
  category?: string | null;
  type?: string | null;
  meanings?: string[];
  readings?: string[];
  items?: WanikaniSubject[];
  mode?: string;
  revealed?: boolean;
  postAttempt?: boolean;
}

type CorrectionTranscript = CheckResult['transcript'] & {
  correction?: {
    heard: string;
    intended: string;
  };
};

// The common surface app.ts needs from a site adapter. getQueuedSubjectIds
// is WaniKani-only (prefetch); reveal/grade* are BunPro-only (Reveal & Grade
// cards) — only bunpro's getContext ever reports mode 'reveal'.
interface SiteAdapter {
  getLanguage(): string;
  getContext(subjects?: WanikaniSubject[]): SiteContext | null;
  didContextChange(oldContext: SiteContext | null | undefined, newContext: SiteContext | null | undefined): boolean;
  clickNext(): boolean;
  markWrong(): boolean;
  submitAnswer(input: string): boolean;
  createCardWatcher(onChange: () => void): MutationObserver;
  getQueuedSubjectIds?(cap?: number): number[];
  reveal?(): boolean;
  gradeGood?(): boolean;
  gradeBad?(): boolean;
}

// The config stamped on the root element by the content script
// (see buildSafeConfig in extension/content.ts).
interface AppConfig {
  base: string;
  settings: Partial<Settings>;
  hasApiToken: boolean;
}

// Pick the per-site adapter. Both expose the same public shape; only WaniKani
// needs subject data fetched via the content script — BunPro's accepted
// answers are already in the DOM.
const SITE = detectSite(window.location.hostname);
const site: SiteAdapter = SITE === 'bunpro' ? bunpro : wanikani;
const startSpeedEnhancer = SITE === 'bunpro' ? startBunproSpeedEnhancer : startWanikaniSpeedEnhancer;
const usesSubjects = SITE !== 'bunpro';
// WaniKani's own server-side check tolerates small typos (edit-distance
// based); mirror that locally so a near-miss answer WaniKani would accept
// still submits. BunPro's Translate questions aren't confirmed to have the
// same tolerance, so keep this WaniKani-only until verified.
const FUZZY_MEANING_MATCHING = SITE === 'wanikani';

// Read config stamped by content.ts, then remove the attribute immediately.
const _encoded = document.documentElement.dataset.kikoeConfig;
document.documentElement.removeAttribute('data-kikoe-config');
const _decoded = decodeConfig<AppConfig>(_encoded);
if (!_decoded) throw new Error('[kikoe] missing or malformed config stamp');
const _config: AppConfig = _decoded;

initSettings(_config.settings);
debugLog('debug mode on — settings:', getSettings());

document.addEventListener('kikoe:settingsChanged', (e) => {
  updateSettings((e as CustomEvent<Partial<Settings>>).detail);
});

// If the user repeats themselves ("night night"), collapse to the first half.
function deduplicate(raw: string): string {
  const words = raw.trim().split(/\s+/);
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const first = words.slice(0, half).join(' ');
    const second = words.slice(half).join(' ');
    if (first.toLowerCase() === second.toLowerCase()) return first;
  }
  return raw;
}

interface SubjectData {
  prompt: string;
  category: string;
  subjects: WanikaniSubject[];
  error?: string | null;
}

// Request subject data from the content script (which holds the API token).
// Resolves { subjects, error } — error is set when the API fetch failed.
function requestSubjects(prompt: string, category: string): Promise<{ subjects: WanikaniSubject[]; error: string | null }> {
  return new Promise((resolve) => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<SubjectData>).detail;
      if (detail.prompt === prompt && detail.category === category) {
        document.removeEventListener('kikoe:subjectData', handler);
        resolve({ subjects: detail.subjects, error: detail.error ?? null });
      }
    }
    document.addEventListener('kikoe:subjectData', handler);
    document.dispatchEvent(new CustomEvent('kikoe:subjectRequest', {
      detail: { prompt, category }
    }));
  });
}

async function startListener(dictionary: Dictionary): Promise<void> {
  createTranscriptContainer(getSettings());

  let subjects: WanikaniSubject[] = [];
  let subjectsLoadFailed = false;
  let context = site.getContext(subjects);
  // Tracks an explicit user mute (voice command or clicking the indicator),
  // separately from the page being hidden/blurred — see
  // updateRecognitionForPageActivity, which must not silently un-mute this.
  let userMuted = false;

  function restoreIdleIndicator(): void {
    if (userMuted) setIdleIndicatorState('muted');
    else if (context?.mode === 'unsupported') setIdleIndicatorState('unsupported');
    else if (subjectsLoadFailed) setIdleIndicatorState('error');
    else setIdleIndicatorState(_config.hasApiToken ? 'listening' : 'no-token');
  }

  async function loadSubjects(prompt: string, category: string): Promise<WanikaniSubject[]> {
    setIdleIndicatorState('loading');
    const { subjects: loaded, error } = await requestSubjects(prompt, category);
    subjectsLoadFailed = !!error;
    if (error) console.error('[kikoe] failed to load subjects:', error);
    return loaded;
  }

  // The content script retries failed fetches (waiting out rate limits);
  // reflect that so a longer wait doesn't look like a stuck "Loading…".
  document.addEventListener('kikoe:subjectRetry', () => setIdleIndicatorState('retrying'));

  // Ask the content script to warm the cache for upcoming cards so they're
  // ready by the time they appear — see requestSubjects for the per-card path
  // this backstops.
  function prefetchUpcoming(): void {
    if (!usesSubjects || typeof site.getQueuedSubjectIds !== 'function') return;
    const subjectIds = site.getQueuedSubjectIds();
    if (subjectIds.length) {
      document.dispatchEvent(new CustomEvent('kikoe:prefetchRequest', { detail: { subjectIds } }));
    }
  }

  // Kick off the initial card's subject fetch now, but don't block the rest
  // of setup on it — recognition starts listening further down before this
  // resolves, so any utterance that arrives while it's in flight is captured
  // as a pending transcript and retried once it resolves (see
  // retryPendingTranscript, awaited at the bottom of this function).
  const initialSubjectsPromise = (usesSubjects && context?.prompt && context?.category)
    ? loadSubjects(context.prompt, context.category)
    : null;

  const transformers = [
    new ToHiragana(), new ConvertWo(),
    new BasicDictionary(dictionary), new SplitDictionary(dictionary),
    new CompoundDictionary(dictionary),
    new SuruVerbs(dictionary), new RepeatingSubstring(),
    new MultipleWords(dictionary), new Numerals(dictionary),
  ];

  // Lookup tables are built from the shared registry (src/commands.ts) so
  // the help panel lists exactly what the matcher accepts.
  const commands = buildCommandTable(SHARED_COMMANDS, {
    'wrong': site.markWrong,
    'next': site.clickNext,
    'pause': () => setMuted(true),
  });

  // Reveal & Grade cards (BunPro, context mode 'reveal') take no typed
  // answer — recognition routes to these command-only tables instead of the
  // checkAnswer path. Both recognizer languages are registered since
  // getLanguage() may pick either; only bunpro.ts produces mode 'reveal',
  // so site.reveal/gradeGood/gradeBad are always defined when these run.
  const revealCommands = buildCommandTable(REVEAL_COMMANDS, {
    'reveal': () => site.reveal?.(),
  });
  const gradeCommands = buildCommandTable(GRADE_COMMANDS, {
    'grade-good': () => site.gradeGood?.(),
    'grade-bad': () => site.gradeBad?.(),
  });

  // Low-priority commands run only after answer matching has failed: "help"
  // is itself an accepted meaning on some cards (助け, 手伝う, …), so unlike
  // the tables above it must never shadow a correct answer.
  const helpCommands = buildCommandTable(HELP_COMMANDS, {
    'help': () => toggleHelp(),
  });

  // Recognizer finals routinely arrive capitalized/punctuated ("Next.") even
  // though the command table only has lowercase keys — normalize before
  // lookup instead of growing the table with every casing variant.
  function normalizeCommand(raw: string): string {
    return raw.trim().toLowerCase().replace(/[.,!?;:。！？]+$/, '').trim();
  }

  // Mirrors checkAlternatives below: try every alternative the recognizer
  // offered, not just the top one, since a garbled top slot can still have
  // the intended command further down the list.
  function matchCommand(raws: string[], table: Record<string, () => unknown> = commands): (() => unknown) | null {
    for (const raw of raws) {
      const command = table[normalizeCommand(raw)];
      if (command) return command;
    }
    return null;
  }

  let submitted = false;
  let pendingRaws: string[] | null = null;
  let emptyFinals = 0;
  let restartIndicatorTimer: ReturnType<typeof setTimeout> | undefined;
  let matchedInterimTimer: ReturnType<typeof setTimeout> | undefined;
  let submittedInterimResultId: string | null = null;

  // While the help panel is open the mic is paused: the panel displays the
  // words that trigger actions, so reading it aloud must not fire them.
  let helpOpen = false;

  function setHelpOpen(open: boolean): void {
    if (helpOpen === open) return;
    helpOpen = open;
    updateRecognitionForPageActivity();
  }

  function helpView(): HelpView {
    const ctx = site.getContext(subjects);
    const mode: HelpMode = ctx?.mode === 'reveal'
      ? (ctx.revealed ? 'reveal-shown' : 'reveal-hidden')
      : 'standard';
    return {
      commands: commandsForMode(mode),
      language: site.getLanguage().startsWith('ja') ? 'Japanese' : 'English',
    };
  }

  function toggleHelp(): void {
    if (isHelpPanelOpen()) {
      closeHelpPanel();
    } else {
      openHelpPanel(getSettings(), helpView(), () => setHelpOpen(false));
      setHelpOpen(true);
    }
  }

  function isPageActive(): boolean {
    const hidden = document.hidden || document.visibilityState === 'hidden';
    const blurred = !isTouchPrimaryDevice() && typeof document.hasFocus === 'function' && !document.hasFocus();
    return !hidden && !blurred;
  }

  // Ranks failure reasons by how actionable they are, so that when several
  // alternatives all fail, the most informative one wins instead of
  // whichever happened to be checked last. 'wrong-type' beats 'no-match'
  // because it tells the user exactly what to do differently; 'not-loaded'
  // is uniform across every alternative (it depends on context, not the
  // candidate), so it never competes with the other two.
  const REASON_PRIORITY: Record<string, number> = { 'wrong-type': 2, 'no-match': 1 };

  // Try every alternative transcript the recognizer offered (ranked by its
  // own confidence) and use the first one that produces a match. Short
  // utterances and common on'yomi are often autocorrected to an unrelated
  // real word in the top slot, but the correct reading is frequently still
  // present further down the list.
  function checkAlternatives(ctx: SiteContext, raws: string[]): CheckResult | undefined {
    let best: CheckResult | undefined;
    // Read corrections at call time so entries saved in the options page
    // apply on the next utterance via the settings-changed event.
    const corrections = getSettings().customCorrections;
    for (const raw of raws) {
      const result = checkAnswer(ctx, transformers, raw, { fuzzyMeaning: FUZZY_MEANING_MATCHING, corrections });
      if (result.success && result.answer) return result;
      const priority = REASON_PRIORITY[result.transcript.reason ?? ''] ?? 0;
      if (!best || priority > (REASON_PRIORITY[best.transcript.reason ?? ''] ?? 0)) best = result;
    }
    // Always display the top alternative's raw text — the reason may have
    // come from a lower-ranked alternative, but the heard text shown to the
    // user should match what was already logged as interim feedback.
    if (best) best.transcript = { ...best.transcript, raw: raws[0] };
    return best;
  }

  function intendedAnswerForCorrection(ctx: SiteContext): string | null {
    if (ctx.type === 'reading') return ctx.readings?.[0] ?? null;
    return ctx.meanings?.[0] ?? null;
  }

  function withCorrectionCandidate(ctx: SiteContext, transcript: CheckResult['transcript']): CorrectionTranscript {
    if (transcript?.reason !== 'no-match') return transcript;
    const intended = intendedAnswerForCorrection(ctx);
    if (!transcript.raw || !intended) return transcript;
    return {
      ...transcript,
      correction: { heard: transcript.raw, intended },
    };
  }

  function correctionMatchesContext(ctx: SiteContext | null | undefined, intended: string): boolean {
    if (!ctx || ctx.mode === 'unsupported') return false;
    if (ctx.type === 'reading') return !!ctx.readings?.includes(intended);
    return !!ctx.meanings?.includes(intended);
  }

  function submitMatchedAnswer(answer: string): boolean {
    if (!site.submitAnswer(answer)) return false;
    submitted = true;
    return true;
  }

  function submitWrongAnswer(): boolean {
    if (!site.markWrong()) return false;
    submitted = true;
    return true;
  }

  // Reading recognition may arrive as romaji or an English-looking engine
  // guess even when it resolves to a valid kana answer. Keep that raw value
  // available to the matcher and correction flow, but successful feedback
  // should show the canonical Japanese answer the user actually submitted.
  function logCheckResult(ctx: SiteContext, result: CheckResult): void {
    if (ctx.type === 'reading' && result.success && result.answer) {
      logTranscript(getSettings(), { raw: result.answer });
      return;
    }
    logTranscript(getSettings(), withCorrectionCandidate(ctx, result.transcript));
  }

  function clearMatchedInterimTimer(): void {
    clearTimeout(matchedInterimTimer);
    matchedInterimTimer = undefined;
  }

  function scheduleMatchedInterimSubmit(
    ctx: SiteContext,
    raws: string[],
    resultId: string,
    result: Extract<CheckResult, { success: true }>,
  ): void {
    clearMatchedInterimTimer();
    matchedInterimTimer = setTimeout(() => {
      if (submitted) return;
      const latestContext = site.getContext(subjects);
      if (site.didContextChange(ctx, latestContext)) return;
      if (latestContext?.type !== 'reading') return;
      logCheckResult(ctx, result);
      if (submitMatchedAnswer(result.answer)) {
        // BunPro Lightning Mode can advance before Chrome emits the final for
        // this utterance. Remember it across the card change so that late
        // final is not checked against the next question as a false miss.
        submittedInterimResultId = resultId;
        debugLog('submitted matched interim after final result stalled', { raws, result });
      }
    }, MATCHED_INTERIM_SUBMIT_MS);
  }

  document.addEventListener('kikoe:addCorrection', (e) => {
    const detail = (e as CustomEvent<Partial<{ intended: string }>>).detail;
    const intended = typeof detail?.intended === 'string' ? detail.intended.trim() : '';
    if (!intended || submitted) return;
    const ctx = site.getContext(subjects);
    if (!correctionMatchesContext(ctx, intended)) return;
    submitMatchedAnswer(intended);
  });

  // Ippatsu (一発) mode: one shot per question. A genuine miss ('no-match' —
  // a right-type answer that didn't match) is submitted as wrong via
  // site.markWrong() instead of waiting for a retry. Recognizer glitches
  // ('wrong-type', 'not-loaded') don't burn the shot. markWrong's placeholder
  // is used rather than the heard text because WaniKani "shakes" without
  // grading on kanji or valid-but-unaccepted alternate readings, which would
  // strand the card with submitted stuck on true.
  function ippatsuEnabled(type: string | null | undefined): boolean {
    const s = getSettings();
    return type === 'reading' ? s.ippatsu_reading : s.ippatsu_meaning;
  }

  // Re-check a transcript that arrived while subjects were still loading
  // (either the initial card's load, or a card change's load in
  // onCardChange), now that they've arrived. No-op if nothing is pending or
  // an answer was already submitted in the meantime.
  function retryPendingTranscript(): void {
    if (!pendingRaws || submitted || !context) return;
    const result = checkAlternatives(context, pendingRaws);
    debugLog('retrying pending transcript', { pendingRaws, result });
    if (result?.success && result.answer) {
      logCheckResult(context, result);
      submitMatchedAnswer(result.answer);
    } else if (result?.transcript?.reason === 'no-match' && ippatsuEnabled(context.type)) {
      submitWrongAnswer();
    }
    pendingRaws = null;
  }

  function handleRecognitionResult(rawInputs: string[], final: boolean, resultId: string): void {
    const raws = rawInputs.map(deduplicate).filter(r => r.trim());
    if (raws.length === 0) {
      if (final && ++emptyFinals >= EMPTY_FINAL_RESTART_THRESHOLD) {
        emptyFinals = 0;
        clearMatchedInterimTimer();
        clearTimeout(restartIndicatorTimer);
        setIdleIndicatorState('restarting');
        recognition.restart();
        restartIndicatorTimer = setTimeout(restoreIdleIndicator, RESTARTING_INDICATOR_MS);
      }
      return;
    }
    emptyFinals = 0;

    if (final && submittedInterimResultId) {
      const isSubmittedInterimFinal = resultId === submittedInterimResultId;
      submittedInterimResultId = null;
      clearMatchedInterimTimer();
      if (isSubmittedInterimFinal) {
        debugLog('ignored late final for an already-submitted interim', { raws });
        return;
      }
    } else if (!final && submittedInterimResultId && submittedInterimResultId !== resultId) {
      // A different recognition result is a new utterance even when its text
      // is identical to the answer just submitted on the previous card.
      submittedInterimResultId = null;
    }

    // A real result means recognition is alive — clear any mic-denied/no-mic/
    // reconnecting indicator left over from a prior error.
    restoreIdleIndicator();
    const raw = raws[0];

    if (final) clearMatchedInterimTimer();

    // Reveal & Grade cards are command-only: match the state-appropriate
    // table first (reveal while the answer is hidden, good/bad once shown),
    // then fall back to the shared commands ('next', 'pause', …) and 'help'.
    // The whole checkAnswer path below is skipped, so no answer-priority
    // concern applies to 'help' here.
    const ctx = site.getContext(subjects);

    // A final result can arrive after the next card is visible but before the
    // debounced card watcher has reset `submitted`. Detect that transition at
    // the recognition boundary and carry this utterance into the normal card
    // refresh path instead of discarding it as speech from the previous card.
    // This is especially noticeable when consecutive questions accept the
    // same answer, because the user can answer the second one immediately.
    if (final && site.didContextChange(context, ctx)) {
      debugLog('answer arrived during card transition; refreshing card first', { raws });
      void onCardChange({ inputs: rawInputs, resultId });
      return;
    }

    // Reading results are logged after matching so a successful romaji or
    // English-looking recognition guess never flashes in the UI. Failures
    // still show the raw guess below, where it can drive correction creation.
    if (ctx?.type !== 'reading') logTranscript(getSettings(), { raw });

    // Interim results are usually display-only, but short reading answers can
    // get stuck there if Chrome shows a correct interim and never emits the
    // final. Only auto-submit an interim when it already resolves to an
    // accepted reading, and give the normal final-result path a short window
    // to arrive first.
    if (!final) {
      if (!submitted && ctx?.type === 'reading') {
        const interimResult = checkAlternatives(ctx, raws);
        if (interimResult?.success && interimResult.answer) {
          logCheckResult(ctx, interimResult);
          scheduleMatchedInterimSubmit(ctx, raws, resultId, interimResult);
          return;
        }
      }
      clearMatchedInterimTimer();
      return;
    }

    if (ctx?.mode === 'reveal') {
      const action = matchCommand(raws, ctx.revealed ? gradeCommands : revealCommands)
        ?? matchCommand(raws)
        ?? matchCommand(raws, helpCommands);
      if (action) { action(); return; }
      logTranscript(getSettings(), { raw, reason: ctx.revealed ? 'say-grade' : 'say-reveal' });
      debugLog('reveal card — no command matched:', raws);
      return;
    }

    // Voice commands take priority over answer submission.
    const command = matchCommand(raws);
    if (command) {
      command();
      return;
    }

    // Low-priority commands ('help') only run once answer matching is off
    // the table — either impossible (below) or attempted and failed (bottom
    // of this function) — so they can never shadow a correct answer.
    const lowCommand = matchCommand(raws, helpCommands);

    // Ignore further speech after the answer has been submitted — wait for card change.
    if (submitted) {
      if (lowCommand) { lowCommand(); return; }
      debugLog('skipped — already submitted');
      return;
    }

    if (!ctx || ctx.mode === 'unsupported') {
      if (lowCommand) { lowCommand(); return; }
      debugLog(ctx ? 'skipped — unsupported card type' : 'skipped — no context');
      return;
    }

    const result = checkAlternatives(ctx, raws);
    if (!result) return;
    debugLog('checkAnswer', { raws, type: ctx.type, readings: ctx.readings, meanings: ctx.meanings, result });

    // A failed answer that reads as 'help' opens the panel instead of
    // logging a no-match hint or burning an ippatsu shot.
    if (!(result.success && result.answer) && lowCommand) {
      lowCommand();
      return;
    }

    logCheckResult(ctx, result);

    if (result.success && result.answer) {
      submitMatchedAnswer(result.answer);
    } else if (!ctx.readings?.length && !ctx.meanings?.length) {
      // Subjects not loaded yet — store transcript and retry once they arrive.
      pendingRaws = raws;
      debugLog('subjects not loaded, stored pending transcript:', raws);
    } else if (result.transcript.reason === 'no-match' && ippatsuEnabled(ctx.type)) {
      submitWrongAnswer();
    }
  }

  function handleRecognitionError(errorType: SpeechRecognitionErrorCode): void {
    const state = RECOGNITION_ERROR_STATES[errorType];
    if (state) setIdleIndicatorState(state);
  }

  const recognitionOrNull = createRecognition(() => site.getLanguage(), handleRecognitionResult, handleRecognitionError);

  if (!recognitionOrNull) {
    // No Web Speech support (e.g. Firefox) — nothing below this point can
    // work, so stop before touching recognition.restart/pause/resume.
    showIdleIndicator(getSettings());
    setIdleIndicatorState('unsupported-browser');
    return;
  }
  // Closures below (and handleRecognitionResult above) capture this non-null
  // binding; the callback only ever fires once a recognizer exists.
  const recognition = recognitionOrNull;

  // Refresh subjects + language and clear transcript when the card changes.
  async function onCardChange(
    transitionResult: { inputs: string[]; resultId: string } | null = null,
  ): Promise<void> {
    const newContext = site.getContext(subjects);
    if (site.didContextChange(context, newContext)) {
      submitted = false;
      pendingRaws = null;
      context = newContext;
      // Change the speech model before waiting for WaniKani subject data.
      // Otherwise the recognizer can spend that loading window interpreting
      // a new Japanese reading card with the previous English card's model.
      setLanguage(recognition, site.getLanguage());
      if (usesSubjects && newContext?.prompt && newContext?.category) {
        subjects = await loadSubjects(newContext.prompt, newContext.category);
        context = site.getContext(subjects);
        restoreIdleIndicator();
        prefetchUpcoming();
      } else {
        // Sites without subject fetches (BunPro) still need the indicator
        // refreshed — e.g. flipping between supported and unsupported cards.
        restoreIdleIndicator();
      }
      if (transitionResult) {
        // Re-enter the complete routing pipeline now that the new context is
        // ready; transition speech may be a command or need normal feedback,
        // not necessarily a directly-submittable answer.
        handleRecognitionResult(transitionResult.inputs, true, transitionResult.resultId);
      } else {
        retryPendingTranscript();
      }
    }
  }

  site.createCardWatcher(onCardChange);

  startSpeedEnhancer(getSettings);

  showIdleIndicator(getSettings(), () => setMuted(!userMuted));

  // The "?" chip next to the indicator; recreated/removed when the setting
  // changes. Saying "help" works regardless of the chip's visibility.
  updateHelpChip(getSettings(), toggleHelp);
  document.addEventListener('kikoe:settingsChanged', () => updateHelpChip(getSettings(), toggleHelp));

  // One-time discovery nudge; content.ts persists the flag so it never
  // shows again once seen.
  if (getSettings().show_help_button && !getSettings().help_hint_shown) {
    showHelpHint(getSettings());
    document.dispatchEvent(new CustomEvent('kikoe:helpHintSeen'));
  }

  // Blur/focus toggles recognition based on page activity, but must not
  // clobber an explicit user mute: muting on a "pause" command or a click on
  // the indicator should stay muted even if the tab loses and regains focus.
  // An open help panel pauses like a blurred tab (see setHelpOpen) and
  // resumes on close, again without clobbering an explicit mute.
  function updateRecognitionForPageActivity(): void {
    clearTimeout(restartIndicatorTimer);
    emptyFinals = 0;
    if (userMuted) {
      recognition.pause();
      restoreIdleIndicator();
    } else if (isPageActive() && !helpOpen) {
      recognition.resume();
      restoreIdleIndicator();
    } else {
      recognition.pause();
      setIdleIndicatorState('paused');
    }
  }

  function setMuted(muted: boolean): void {
    if (userMuted === muted) return;
    userMuted = muted;
    updateRecognitionForPageActivity();
  }

  document.addEventListener('visibilitychange', updateRecognitionForPageActivity);
  window.addEventListener('focus', updateRecognitionForPageActivity);
  window.addEventListener('blur', updateRecognitionForPageActivity);
  updateRecognitionForPageActivity();

  // Recognition is listening as of the call above. Now wait for the initial
  // card's subjects (already in flight since the top of this function) and
  // retry anything the user said while they were still loading — mirrors the
  // retryPendingTranscript() call in onCardChange for later cards.
  if (initialSubjectsPromise) {
    subjects = await initialSubjectsPromise;
    context = site.getContext(subjects);
    restoreIdleIndicator();
    retryPendingTranscript();
  }
  prefetchUpcoming();
}

async function init(): Promise<void> {
  // Don't block startup on the ~12 MB dictionary fetch/parse — start
  // listening immediately with an empty dictionary and let it fill in place
  // as entries arrive. Transformers hold a reference to the same object, so
  // no further plumbing is needed once it's populated.
  const { dictionary, ready: dictionaryReady } = loadDictionary(_config.base);
  dictionaryReady.catch(err => console.error('[kikoe] dictionary load failed:', err));
  let listenerStarted = false;

  function tryStart(): void {
    if (listenerStarted) return;
    const context = site.getContext();
    if (!context) return;
    if (context.page === 'review' || context.page === 'lesson' || context.page === 'quiz') {
      listenerStarted = true;
      startListener(dictionary);
    }
  }

  tryStart();
  // WaniKani navigates with Turbo; BunPro is a React SPA with no equivalent
  // event, so also watch the DOM until the quiz appears.
  document.addEventListener('turbo:load', tryStart);
  const startObserver = new MutationObserver(() => {
    tryStart();
    if (listenerStarted) startObserver.disconnect();
  });
  startObserver.observe(document.documentElement, { childList: true, subtree: true });
}

init().catch(err => console.error('[kikoe] init error:', err));
