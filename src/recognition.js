const MIN_INDICATE = 100;

export function createRecognition(lang, callback) {
  if (!('webkitSpeechRecognition' in window)) {
    console.error('[wanikani-voice-input] web speech not supported by this browser!');
    return null;
  }

  // Accept a function so callers can supply a live language getter; this ensures
  // every auto-restart picks up the correct language even if setLanguage was
  // called with a stale value during a DOM transition.
  const getLang = typeof lang === 'function' ? lang : () => lang;

  const recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
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
    //console.info('[wanikani-voice-input] onresult', event);

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcript = event.results[i][0].transcript.trim();
      const final = event.results[i].isFinal;
      callback(transcript, final);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech') {
      return;
    }
    console.error('[wanikani-voice-input] error occurred in recognition:', event.error);
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
