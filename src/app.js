import { checkAnswer } from './flashcards';
import { createRecognition, setLanguage } from './recognition';
import * as wanikani from './wanikani.js';
import * as bunpro from './bunpro.js';
import { detectSite } from './site';
import { initSettings, updateSettings, getSettings } from './settings';
import { debugLog } from './logger';
import { startSpeedEnhancer as startWanikaniSpeedEnhancer } from './speed.js';
import { startSpeedEnhancer as startBunproSpeedEnhancer } from './bunpro_speed.js';
import { createTranscriptContainer, logTranscript, showIdleIndicator, setIdleIndicatorState } from './live_transcript.js';
import { loadDictionary } from './dict';

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

// Maps a SpeechRecognition error type to the idle-indicator state that
// explains it to the user. Errors with no entry here (e.g. 'aborted') keep
// whatever indicator state is already showing — recognition.js still logs them.
const RECOGNITION_ERROR_STATES = {
  'not-allowed': 'mic-denied',
  'service-not-allowed': 'mic-denied',
  'audio-capture': 'no-mic',
  'network': 'reconnecting',
};

// Pick the per-site adapter. Both expose the same public shape; only WaniKani
// needs subject data fetched via the content script — BunPro's accepted
// answers are already in the DOM.
const SITE = detectSite(window.location.hostname);
const site = SITE === 'bunpro' ? bunpro : wanikani;
const startSpeedEnhancer = SITE === 'bunpro' ? startBunproSpeedEnhancer : startWanikaniSpeedEnhancer;
const usesSubjects = SITE !== 'bunpro';
// WaniKani's own server-side check tolerates small typos (edit-distance
// based); mirror that locally so a near-miss answer WaniKani would accept
// still submits. BunPro's Translate questions aren't confirmed to have the
// same tolerance, so keep this WaniKani-only until verified.
const FUZZY_MEANING_MATCHING = SITE === 'wanikani';

// Read config stamped by content.js, then remove the attribute immediately.
const _encoded = document.documentElement.dataset.kikoeConfig;
document.documentElement.removeAttribute('data-kikoe-config');
const _config = JSON.parse(atob(_encoded));

initSettings(_config.settings);
debugLog('debug mode on — settings:', getSettings());

document.addEventListener('kikoe:settingsChanged', (e) => {
  updateSettings(e.detail);
});

// If the user repeats themselves ("night night"), collapse to the first half.
function deduplicate(raw) {
  const words = raw.trim().split(/\s+/);
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const first = words.slice(0, half).join(' ');
    const second = words.slice(half).join(' ');
    if (first.toLowerCase() === second.toLowerCase()) return first;
  }
  return raw;
}

// Request subject data from the content script (which holds the API token).
// Resolves { subjects, error } — error is set when the API fetch failed.
function requestSubjects(prompt, category) {
  return new Promise((resolve) => {
    function handler(e) {
      if (e.detail.prompt === prompt && e.detail.category === category) {
        document.removeEventListener('kikoe:subjectData', handler);
        resolve({ subjects: e.detail.subjects, error: e.detail.error ?? null });
      }
    }
    document.addEventListener('kikoe:subjectData', handler);
    document.dispatchEvent(new CustomEvent('kikoe:subjectRequest', {
      detail: { prompt, category }
    }));
  });
}

async function startListener(dictionary) {
  createTranscriptContainer(getSettings());

  let subjects = [];
  let subjectsLoadFailed = false;
  let context = site.getContext(subjects);
  // Tracks an explicit user mute (voice command or clicking the indicator),
  // separately from the page being hidden/blurred — see
  // updateRecognitionForPageActivity, which must not silently un-mute this.
  let userMuted = false;

  function restoreIdleIndicator() {
    if (userMuted) setIdleIndicatorState('muted');
    else if (context?.mode === 'unsupported') setIdleIndicatorState('unsupported');
    else if (subjectsLoadFailed) setIdleIndicatorState('error');
    else setIdleIndicatorState(_config.hasApiToken ? 'listening' : 'no-token');
  }

  async function loadSubjects(prompt, category) {
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
  function prefetchUpcoming() {
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

  const commands = {
    'wrong': site.markWrong, 'incorrect': site.markWrong, 'mistake': site.markWrong,
    '不正解': site.markWrong, 'ふせいかい': site.markWrong, '間違い': site.markWrong,
    'まちがい': site.markWrong, 'だめ': site.markWrong, 'ダメ': site.markWrong,
    '駄目': site.markWrong,
    'next': site.clickNext, 'つぎ': site.clickNext, '次': site.clickNext,
    'ねくすと': site.clickNext, 'ネクスト': site.clickNext,
    // Resuming by voice while paused is impossible (recognition is stopped),
    // so this is deliberately pause-only — resuming needs the UI control.
    'pause': () => setMuted(true), 'stop listening': () => setMuted(true),
    'ストップ': () => setMuted(true),
  };

  // Reveal & Grade cards (BunPro, context mode 'reveal') take no typed
  // answer — recognition routes to these command-only tables instead of the
  // checkAnswer path. Both recognizer languages are registered since
  // getLanguage() may pick either; only bunpro.js produces mode 'reveal',
  // so site.reveal/gradeGood/gradeBad are always defined when these run.
  const revealCommands = {
    'reveal': () => site.reveal(), 'show': () => site.reveal(),
    'show answer': () => site.reveal(), 'answer': () => site.reveal(),
    '見せて': () => site.reveal(), 'みせて': () => site.reveal(),
    '答え': () => site.reveal(), 'こたえ': () => site.reveal(),
  };
  const gradeCommands = {
    'good': () => site.gradeGood(), 'known': () => site.gradeGood(),
    'correct': () => site.gradeGood(),
    'わかった': () => site.gradeGood(), '分かった': () => site.gradeGood(),
    'bad': () => site.gradeBad(), 'again': () => site.gradeBad(),
    'わからない': () => site.gradeBad(), '分からない': () => site.gradeBad(),
  };

  // Recognizer finals routinely arrive capitalized/punctuated ("Next.") even
  // though the command table only has lowercase keys — normalize before
  // lookup instead of growing the table with every casing variant.
  function normalizeCommand(raw) {
    return raw.trim().toLowerCase().replace(/[.,!?;:。！？]+$/, '').trim();
  }

  // Mirrors checkAlternatives below: try every alternative the recognizer
  // offered, not just the top one, since a garbled top slot can still have
  // the intended command further down the list.
  function matchCommand(raws, table = commands) {
    for (const raw of raws) {
      const command = table[normalizeCommand(raw)];
      if (command) return command;
    }
    return null;
  }

  let submitted = false;
  let pendingRaws = null;
  let emptyFinals = 0;
  let restartIndicatorTimer;

  function isPageActive() {
    const hidden = document.hidden || document.visibilityState === 'hidden';
    const blurred = typeof document.hasFocus === 'function' && !document.hasFocus();
    return !hidden && !blurred;
  }

  // Ranks failure reasons by how actionable they are, so that when several
  // alternatives all fail, the most informative one wins instead of
  // whichever happened to be checked last. 'wrong-type' beats 'no-match'
  // because it tells the user exactly what to do differently; 'not-loaded'
  // is uniform across every alternative (it depends on context, not the
  // candidate), so it never competes with the other two.
  const REASON_PRIORITY = { 'wrong-type': 2, 'no-match': 1 };

  // Try every alternative transcript the recognizer offered (ranked by its
  // own confidence) and use the first one that produces a match. Short
  // utterances and common on'yomi are often autocorrected to an unrelated
  // real word in the top slot, but the correct reading is frequently still
  // present further down the list.
  function checkAlternatives(ctx, raws) {
    let best;
    // Read corrections at call time so entries saved in the options page
    // apply on the next utterance via the settings-changed event.
    const corrections = getSettings().customCorrections;
    for (const raw of raws) {
      const result = checkAnswer(ctx, transformers, raw, { fuzzyMeaning: FUZZY_MEANING_MATCHING, corrections });
      if (result.success && result.answer) return result;
      const priority = REASON_PRIORITY[result.transcript?.reason] ?? 0;
      if (!best || priority > (REASON_PRIORITY[best.transcript?.reason] ?? 0)) best = result;
    }
    // Always display the top alternative's raw text — the reason may have
    // come from a lower-ranked alternative, but the heard text shown to the
    // user should match what was already logged as interim feedback.
    if (best) best.transcript = { ...best.transcript, raw: raws[0] };
    return best;
  }

  // Ippatsu (一発) mode: one shot per question. A genuine miss ('no-match' —
  // a right-type answer that didn't match) is submitted as wrong via
  // site.markWrong() instead of waiting for a retry. Recognizer glitches
  // ('wrong-type', 'not-loaded') don't burn the shot. markWrong's placeholder
  // is used rather than the heard text because WaniKani "shakes" without
  // grading on kanji or valid-but-unaccepted alternate readings, which would
  // strand the card with submitted stuck on true.
  function ippatsuEnabled(type) {
    const s = getSettings();
    return type === 'reading' ? s.ippatsu_reading : s.ippatsu_meaning;
  }

  // Re-check a transcript that arrived while subjects were still loading
  // (either the initial card's load, or a card change's load in
  // onCardChange), now that they've arrived. No-op if nothing is pending or
  // an answer was already submitted in the meantime.
  function retryPendingTranscript() {
    if (!pendingRaws || submitted) return;
    const result = checkAlternatives(context, pendingRaws);
    debugLog('retrying pending transcript', { pendingRaws, result });
    if (result.success && result.answer) {
      submitted = true;
      site.submitAnswer(result.answer);
    } else if (result?.transcript?.reason === 'no-match' && ippatsuEnabled(context.type)) {
      submitted = true;
      site.markWrong();
    }
    pendingRaws = null;
  }

  function handleRecognitionResult(rawInputs, final) {
    const raws = rawInputs.map(deduplicate).filter(r => r.trim());
    if (raws.length === 0) {
      if (final && ++emptyFinals >= EMPTY_FINAL_RESTART_THRESHOLD) {
        emptyFinals = 0;
        clearTimeout(restartIndicatorTimer);
        setIdleIndicatorState('restarting');
        recognition.restart();
        restartIndicatorTimer = setTimeout(restoreIdleIndicator, RESTARTING_INDICATOR_MS);
      }
      return;
    }
    emptyFinals = 0;
    // A real result means recognition is alive — clear any mic-denied/no-mic/
    // reconnecting indicator left over from a prior error.
    restoreIdleIndicator();
    const raw = raws[0];
    logTranscript(getSettings(), { raw });

    // Only process on final results — interim results are shown for feedback only.
    if (!final) return;

    // Reveal & Grade cards are command-only: match the state-appropriate
    // table first (reveal while the answer is hidden, good/bad once shown),
    // then fall back to the shared commands ('next', 'pause', …). The whole
    // checkAnswer path below is skipped.
    const ctx = site.getContext(subjects);
    if (ctx?.mode === 'reveal') {
      const action = matchCommand(raws, ctx.revealed ? gradeCommands : revealCommands)
        ?? matchCommand(raws);
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

    // Ignore further speech after the answer has been submitted — wait for card change.
    if (submitted) { debugLog('skipped — already submitted'); return; }

    if (!ctx) { debugLog('skipped — no context'); return; }
    if (ctx.mode === 'unsupported') { debugLog('skipped — unsupported card type'); return; }

    const result = checkAlternatives(ctx, raws);
    logTranscript(getSettings(), result.transcript);
    debugLog('checkAnswer', { raws, type: ctx.type, readings: ctx.readings, meanings: ctx.meanings, result });

    if (result.success && result.answer) {
      submitted = true;
      site.submitAnswer(result.answer);
    } else if (!ctx.readings?.length && !ctx.meanings?.length) {
      // Subjects not loaded yet — store transcript and retry once they arrive.
      pendingRaws = raws;
      debugLog('subjects not loaded, stored pending transcript:', raws);
    } else if (result.transcript?.reason === 'no-match' && ippatsuEnabled(ctx.type)) {
      submitted = true;
      site.markWrong();
    }
  }

  function handleRecognitionError(errorType) {
    const state = RECOGNITION_ERROR_STATES[errorType];
    if (state) setIdleIndicatorState(state);
  }

  const recognition = createRecognition(() => site.getLanguage(), handleRecognitionResult, handleRecognitionError);

  if (!recognition) {
    // No Web Speech support (e.g. Firefox) — nothing below this point can
    // work, so stop before touching recognition.restart/pause/resume.
    showIdleIndicator(getSettings());
    setIdleIndicatorState('unsupported-browser');
    return;
  }

  // Refresh subjects + language and clear transcript when the card changes.
  async function onCardChange() {
    const newContext = site.getContext(subjects);
    if (site.didContextChange(context, newContext)) {
      submitted = false;
      pendingRaws = null;
      context = newContext;
      if (usesSubjects && newContext?.prompt && newContext?.category) {
        subjects = await loadSubjects(newContext.prompt, newContext.category);
        context = site.getContext(subjects);
        restoreIdleIndicator();
        prefetchUpcoming();
        retryPendingTranscript();
      } else {
        // Sites without subject fetches (BunPro) still need the indicator
        // refreshed — e.g. flipping between supported and unsupported cards.
        restoreIdleIndicator();
      }
      setLanguage(recognition, site.getLanguage());
    }
  }

  site.createCardWatcher(onCardChange);

  startSpeedEnhancer(getSettings);

  showIdleIndicator(getSettings(), () => setMuted(!userMuted));

  // Blur/focus toggles recognition based on page activity, but must not
  // clobber an explicit user mute: muting on a "pause" command or a click on
  // the indicator should stay muted even if the tab loses and regains focus.
  function updateRecognitionForPageActivity() {
    clearTimeout(restartIndicatorTimer);
    emptyFinals = 0;
    if (userMuted) {
      recognition.pause();
      restoreIdleIndicator();
    } else if (isPageActive()) {
      recognition.resume();
      restoreIdleIndicator();
    } else {
      recognition.pause();
      setIdleIndicatorState('paused');
    }
  }

  function setMuted(muted) {
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

async function init() {
  // Don't block startup on the ~12 MB dictionary fetch/parse — start
  // listening immediately with an empty dictionary and let it fill in place
  // as entries arrive. Transformers hold a reference to the same object, so
  // no further plumbing is needed once it's populated.
  const { dictionary, ready: dictionaryReady } = loadDictionary(_config.base);
  dictionaryReady.catch(err => console.error('[kikoe] dictionary load failed:', err));
  let listenerStarted = false;

  function tryStart() {
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
