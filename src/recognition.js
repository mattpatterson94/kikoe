const MIN_INDICATE = 100;

// Short utterances and common on'yomi (かい, けい, どう, ...) are frequently
// autocorrected by the recognizer into an unrelated real word, since its
// language model favors known vocabulary over an isolated mora. The correct
// reading is often still present among the engine's lower-ranked guesses, so
// ask for several and let the caller check all of them instead of only the
// top pick.
const MAX_ALTERNATIVES = 5;

export function createRecognition(lang, callback) {
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
  };

  recognition.onend = () => {
    if (shouldAutoRestart) safeStart();
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
