
// Short utterances and common on'yomi (かい, けい, どう, ...) are frequently
// autocorrected by the recognizer into an unrelated real word, since its
// language model favors known vocabulary over an isolated mora. The correct
// reading is often still present among the engine's lower-ranked guesses, so
// ask for several and let the caller check all of them instead of only the
// top pick.
const MAX_ALTERNATIVES = 5;

// Errors after which retrying without backoff would just hot-loop against a
// permission dialog or a missing device — the auto-restart in onend must stop.
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

// Transient 'network' errors back off geometrically instead of restarting
// immediately, so a flaky connection doesn't spin the recognizer in a loop.
const NETWORK_BACKOFF_MS = 1000;
const MAX_NETWORK_BACKOFF_MS = 8000;

export function createRecognition(lang, callback, onError) {
  if (!('webkitSpeechRecognition' in window)) {
    console.error('[kikoe] web speech not supported by this browser!');
    return null;
  }

  // Accept a function so callers can supply a live language getter; this ensures
  // every auto-restart picks up the correct language even if setLanguage was
  // called with a stale value during a DOM transition.
  const getLang = typeof lang === 'function' ? lang : () => lang;

  const recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = MAX_ALTERNATIVES;
  recognition.lang = getLang();
  let shouldAutoRestart = true;
  let networkErrorStreak = 0;
  const start = recognition.start.bind(recognition);
  const stop = recognition.stop.bind(recognition);

  function safeStart() {
    recognition.lang = getLang();
    try {
      start();
    } catch (err) {
      if (err.name !== 'InvalidStateError') throw err;
    }
  }

  function safeStop() {
    try {
      stop();
    } catch (err) {
      if (err.name !== 'InvalidStateError') throw err;
    }
  }

  recognition.onresult = (event) => {
    //console.info('[kikoe] onresult', event);
    networkErrorStreak = 0;

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const result = event.results[i];
      // Interim results are only ever given one alternative by the engine;
      // final results may carry up to maxAlternatives, ranked by confidence.
      const transcripts = Array.from(result, alt => alt.transcript.trim());
      callback(transcripts, result.isFinal);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech') {
      return;
    }
    console.error('[kikoe] error occurred in recognition:', event.error);

    if (FATAL_ERRORS.has(event.error)) {
      shouldAutoRestart = false;
    } else if (event.error === 'network') {
      networkErrorStreak++;
    }

    onError?.(event.error);
  };

  recognition.onend = () => {
    if (!shouldAutoRestart) return;
    if (networkErrorStreak > 0) {
      const delay = Math.min(networkErrorStreak * NETWORK_BACKOFF_MS, MAX_NETWORK_BACKOFF_MS);
      setTimeout(() => { if (shouldAutoRestart) safeStart(); }, delay);
    } else {
      safeStart();
    }
  };

  recognition.start = () => {
    shouldAutoRestart = true;
    safeStart();
  };

  recognition.pause = () => {
    shouldAutoRestart = false;
    safeStop();
  };

  recognition.resume = () => {
    shouldAutoRestart = true;
    safeStart();
  };

  recognition.restart = () => {
    shouldAutoRestart = true;
    safeStop();
  };

  recognition.isPaused = () => {
    return !shouldAutoRestart;
  };

  return recognition;
}

export function setLanguage(recognition, newLanguage) {
  if (recognition.lang != newLanguage) {
    recognition.lang = newLanguage;
    if (!recognition.isPaused?.()) recognition.restart();
  }
}
