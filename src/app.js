import { checkAnswer } from './flashcards.js';
import { createRecognition, setLanguage } from './recognition.js';
import * as wk from './wanikani.js';
import { initSettings, updateSettings, getSettings } from './settings.js';
import { startSpeedEnhancer } from './speed.js';
import { createTranscriptContainer, logTranscript, clearTranscript, showIdleIndicator, setIdleIndicatorState } from './live_transcript.js';
import { loadDictionary } from './dict.js';

import { ToHiragana } from './candidates/to_hiragana.js';
import { ConvertWo } from './candidates/convert_wo.js';
import { BasicDictionary } from './candidates/basic_dictionary.js';
import { SplitDictionary } from './candidates/split_dictionary.js';
import { CompoundDictionary } from './candidates/compound_dictionary.js';
import { SuruVerbs } from './candidates/suru_verbs.js';
import { RepeatingSubstring } from './candidates/repeating.js';
import { FuzzyVowels } from './candidates/fuzzy_vowels.js';
import { MultipleWords } from './candidates/multiple.js';
import { Numerals } from './candidates/numerals.js';

const EMPTY_FINAL_RESTART_THRESHOLD = 3;
const RESTARTING_INDICATOR_MS = 900;

// Read config stamped by content.js, then remove the attribute immediately.
const _encoded = document.documentElement.dataset.wkviConfig;
document.documentElement.removeAttribute('data-wkvi-config');
const _config = JSON.parse(atob(_encoded));

initSettings(_config.settings);

document.addEventListener('wkvi:settingsChanged', (e) => {
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
        document.removeEventListener('wkvi:subjectData', handler);
        resolve({ subjects: e.detail.subjects, error: e.detail.error ?? null });
      }
    }
    document.addEventListener('wkvi:subjectData', handler);
    document.dispatchEvent(new CustomEvent('wkvi:subjectRequest', {
      detail: { prompt, category }
    }));
  });
}

async function startListener(dictionary) {
  createTranscriptContainer(getSettings());

  let subjects = [];
  let subjectsLoadFailed = false;
  let context = wk.getContext(subjects);

  function restoreIdleIndicator() {
    if (subjectsLoadFailed) setIdleIndicatorState('error');
    else setIdleIndicatorState(_config.hasApiToken ? 'listening' : 'no-token');
  }

  async function loadSubjects(prompt, category) {
    setIdleIndicatorState('loading');
    const { subjects: loaded, error } = await requestSubjects(prompt, category);
    subjectsLoadFailed = !!error;
    if (error) console.error('[wkvi] failed to load subjects:', error);
    return loaded;
  }

  // The content script retries failed fetches (waiting out rate limits);
  // reflect that so a longer wait doesn't look like a stuck "Loading…".
  document.addEventListener('wkvi:subjectRetry', () => setIdleIndicatorState('retrying'));

  // Pre-fetch subjects for the initial card.
  if (context?.prompt && context?.category) {
    subjects = await loadSubjects(context.prompt, context.category);
    context = wk.getContext(subjects);
    restoreIdleIndicator();
  }

  const transformers = [
    new ToHiragana(), new ConvertWo(),
    new BasicDictionary(dictionary), new SplitDictionary(dictionary),
    new CompoundDictionary(dictionary),
    new SuruVerbs(dictionary), new RepeatingSubstring(),
    new MultipleWords(dictionary), new Numerals(dictionary),
  ];

  const commands = {
    'wrong': wk.markWrong, 'incorrect': wk.markWrong, 'mistake': wk.markWrong,
    '不正解': wk.markWrong, 'ふせいかい': wk.markWrong, '間違い': wk.markWrong,
    'まちがい': wk.markWrong, 'だめ': wk.markWrong, 'ダメ': wk.markWrong,
    '駄目': wk.markWrong,
    'next': wk.clickNext, 'つぎ': wk.clickNext, '次': wk.clickNext, 'NEXT': wk.clickNext,
    'ねくすと': wk.clickNext, 'ネクスト': wk.clickNext,
  };

  let submitted = false;
  let pendingRaw = null;
  let emptyFinals = 0;
  let restartIndicatorTimer;

  function isPageActive() {
    const hidden = document.hidden || document.visibilityState === 'hidden';
    const blurred = typeof document.hasFocus === 'function' && !document.hasFocus();
    return !hidden && !blurred;
  }

  const recognition = createRecognition(() => wk.getLanguage(), function(rawInput, final) {
    const raw = deduplicate(rawInput);
    if (!raw.trim()) {
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
    logTranscript(getSettings(), { raw });

    // Only process on final results — interim results are shown for feedback only.
    if (!final) return;

    // Voice commands take priority over answer submission.
    if (commands[raw]) {
      commands[raw]();
      return;
    }

    // Ignore further speech after the answer has been submitted — wait for card change.
    if (submitted) { console.log('[wkvi] skipped — already submitted'); return; }

    const ctx = wk.getContext(subjects);
    if (!ctx) { console.log('[wkvi] skipped — no context'); return; }

    const result = checkAnswer(ctx, transformers, raw);
    logTranscript(getSettings(), result.transcript);
    console.log('[wkvi] checkAnswer', { raw, type: ctx.type, readings: ctx.readings, meanings: ctx.meanings, result });

    if (result.success && result.answer) {
      submitted = true;
      wk.submitAnswer(result.answer);
    } else if (!ctx.readings?.length && !ctx.meanings?.length) {
      // Subjects not loaded yet — store transcript and retry once they arrive.
      pendingRaw = raw;
      console.log('[wkvi] subjects not loaded, stored pending transcript:', raw);
    }
  });

  // Refresh subjects + language and clear transcript when the card changes.
  async function onCardChange() {
    const newContext = wk.getContext(subjects);
    if (wk.didContextChange(context, newContext)) {
      submitted = false;
      pendingRaw = null;
      context = newContext;
      if (newContext?.prompt && newContext?.category) {
        subjects = await loadSubjects(newContext.prompt, newContext.category);
        context = wk.getContext(subjects);
        restoreIdleIndicator();
        // Retry any transcript that arrived while subjects were loading.
        if (pendingRaw && !submitted) {
          const result = checkAnswer(context, transformers, pendingRaw);
          console.log('[wkvi] retrying pending transcript', { pendingRaw, result });
          if (result.success && result.answer) {
            submitted = true;
            wk.submitAnswer(result.answer);
          }
          pendingRaw = null;
        }
      }
      setLanguage(recognition, wk.getLanguage());
      if (getSettings().transcript_clear) clearTranscript();
    }
  }

  // Only trigger card change when the prompt+type DOM elements settle on new
  // values. This ignores unrelated mutations (animations, the `correct`
  // attribute, progress bars) that would otherwise reset a naive debounce and
  // prevent onCardChange from ever firing.
  let lastSeenPrompt = context?.prompt;
  let lastSeenType = context?.type;
  let cardChangeTimer;

  const observer = new MutationObserver(() => {
    const prompt = document.querySelector('div.character-header__characters')?.textContent?.trim();
    const type = document.querySelector('span.quiz-input__question-type')?.textContent?.trim().toLowerCase();
    if (!prompt || !type) return;
    if (prompt === lastSeenPrompt && type === lastSeenType) return;
    lastSeenPrompt = prompt;
    lastSeenType = type;
    clearTimeout(cardChangeTimer);
    cardChangeTimer = setTimeout(onCardChange, 50);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  startSpeedEnhancer(getSettings);

  showIdleIndicator(getSettings());

  function updateRecognitionForPageActivity() {
    clearTimeout(restartIndicatorTimer);
    emptyFinals = 0;
    if (isPageActive()) {
      recognition.resume();
      restoreIdleIndicator();
    } else {
      recognition.pause();
      setIdleIndicatorState('paused');
    }
  }

  document.addEventListener('visibilitychange', updateRecognitionForPageActivity);
  window.addEventListener('focus', updateRecognitionForPageActivity);
  window.addEventListener('blur', updateRecognitionForPageActivity);
  updateRecognitionForPageActivity();
}

async function init() {
  const dictionary = await loadDictionary(_config.base);
  let listenerStarted = false;

  function tryStart() {
    if (listenerStarted) return;
    const context = wk.getContext();
    if (!context) return;
    if (context.page === 'review' || context.page === 'lesson' || context.page === 'quiz') {
      listenerStarted = true;
      startListener(dictionary);
    }
  }

  tryStart();
  document.addEventListener('turbo:load', tryStart);
}

init().catch(err => console.error('[wkvi] init error:', err));
