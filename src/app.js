import { checkAnswer } from './flashcards.js';
import { createRecognition, setLanguage } from './recognition.js';
import * as wk from './wanikani.js';
import { initSettings, updateSettings, getSettings } from './settings.js';
import { startSpeedEnhancer } from './speed.js';
import { createTranscriptContainer, logTranscript, clearTranscript } from './live_transcript.js';
import { loadDictionary } from './dict.js';

import { ToHiragana } from './candidates/to_hiragana.js';
import { ConvertWo } from './candidates/convert_wo.js';
import { BasicDictionary } from './candidates/basic_dictionary.js';
import { SplitDictionary } from './candidates/split_dictionary.js';
import { SuruVerbs } from './candidates/suru_verbs.js';
import { RepeatingSubstring } from './candidates/repeating.js';
import { FuzzyVowels } from './candidates/fuzzy_vowels.js';
import { MultipleWords } from './candidates/multiple.js';
import { Numerals } from './candidates/numerals.js';

// Read config stamped by content.js, then remove the attribute immediately.
const _encoded = document.documentElement.dataset.wkviConfig;
document.documentElement.removeAttribute('data-wkvi-config');
const _config = JSON.parse(atob(_encoded));

initSettings(_config.settings);

document.addEventListener('wkvi:settingsChanged', (e) => {
  updateSettings(e.detail);
});

// Request subject data for a given prompt/category from the content script.
// The content script holds the API token and handles caching.
function requestSubjects(prompt, category) {
  return new Promise((resolve) => {
    function handler(e) {
      if (e.detail.prompt === prompt && e.detail.category === category) {
        document.removeEventListener('wkvi:subjectData', handler);
        resolve(e.detail.subjects);
      }
    }
    document.addEventListener('wkvi:subjectData', handler);
    document.dispatchEvent(new CustomEvent('wkvi:subjectRequest', {
      detail: { prompt, category }
    }));
  });
}

function handleSpeechRecognition(subjects, transformers, state, commands, raw, final) {
  let newState = state;
  let answer = null;
  let transcript = { raw };

  if (state === 'Ready') {
    const context = wk.getContext(subjects);
    const result = checkAnswer(context, transformers, raw);
    console.log('[wkvi]', raw, result, context);
    if (result.candidate && transcript.raw !== result.candidate.data) {
      transcript.matched = result.candidate.data;
    }
    if (result.success) {
      answer = result.answer;
      if (!final) newState = 'Waiting';
    } else if (result.error) {
      transcript = '!! ' + result.message + ' !!';
    }
  }
  if (state === 'Waiting' && final) {
    newState = 'Ready';
  }

  const context = wk.getContext(subjects);
  if (state === 'Ready' && final && commands[raw]) {
    return { newState, transcript, answer: null, command: commands[raw] };
  }

  return { newState, transcript, answer, command: null };
}

async function startListener(dictionary) {
  createTranscriptContainer(getSettings());

  let subjects = [];
  let state = 'Ready';
  let context = wk.getContext(subjects);

  // Pre-fetch subjects for the initial card.
  if (context?.prompt && context?.category) {
    subjects = await requestSubjects(context.prompt, context.category);
    context = wk.getContext(subjects);
  }

  function setState(s) { state = s; }

  function next() {
    wk.clickNext();
    setState('Ready');
  }

  const commands = {
    'wrong': wk.markWrong, 'incorrect': wk.markWrong, 'mistake': wk.markWrong,
    '不正解': wk.markWrong, 'ふせいかい': wk.markWrong, '間違い': wk.markWrong,
    'まちがい': wk.markWrong, 'だめ': wk.markWrong, 'ダメ': wk.markWrong,
    '駄目': wk.markWrong,
    'next': next, 'つぎ': next, '次': next, 'NEXT': next,
    'ねくすと': next, 'ネクスト': next,
  };

  const transformers = [
    new ToHiragana(), new ConvertWo(),
    new BasicDictionary(dictionary), new SplitDictionary(dictionary),
    new SuruVerbs(dictionary), new RepeatingSubstring(),
    new MultipleWords(dictionary), new Numerals(),
  ];

  const lang = wk.getLanguage();
  const recognition = createRecognition(lang, function(raw, final) {
    logTranscript(getSettings(), { raw });
    const outcome = handleSpeechRecognition(subjects, transformers, state, commands, raw, final);
    logTranscript(getSettings(), outcome.transcript);
    if (state !== outcome.newState) setState(outcome.newState);
    if (outcome.answer) wk.submitAnswer(outcome.answer);
    if (outcome.command) outcome.command();

    const newContext = wk.getContext(subjects);
    if (final && wk.didContextChange(context, newContext)) {
      context = newContext;
      if (getSettings().transcript_clear) clearTranscript();
    }
  });

  // Refresh subjects and language when the card changes.
  async function onCardChange() {
    const newContext = wk.getContext(subjects);
    if (wk.didContextChange(context, newContext)) {
      context = newContext;
      if (newContext?.prompt && newContext?.category) {
        subjects = await requestSubjects(newContext.prompt, newContext.category);
      }
      const newLang = wk.getLanguage();
      setLanguage(recognition, newLang);
      if (getSettings().transcript_clear) clearTranscript();
    }
  }

  const observer = new MutationObserver(onCardChange);
  observer.observe(document.body, { attributes: true, childList: true, subtree: true });

  startSpeedEnhancer(getSettings);

  recognition.start();
  state = 'Ready';
}

async function init() {
  const dictionary = await loadDictionary(_config.base);
  const context = wk.getContext([]);

  if (!context) return;
  if (context.page === 'review' || context.page === 'lesson' || context.page === 'quiz') {
    startListener(dictionary);
  }
}

init().catch(err => console.error('[wkvi] init error:', err));
