import { createRecognition } from '../src/recognition';

let recognitionInstances;

class MockSpeechRecognition {
  constructor() {
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.lang = '';
    this.nativeStart = vi.fn();
    this.nativeStop = vi.fn();
    this.nativeAbort = vi.fn();
    this.start = this.nativeStart;
    this.stop = this.nativeStop;
    this.abort = this.nativeAbort;
    recognitionInstances.push(this);
  }
}

// An engine without the optional abort() — restart must still work.
class MockSpeechRecognitionWithoutAbort extends MockSpeechRecognition {
  constructor() {
    super();
    delete this.abort;
  }
}

// Mimics a SpeechRecognitionResult: array-like of alternatives with an
// isFinal flag on the result itself, not each alternative.
function makeResult(transcripts, isFinal) {
  const result = transcripts.map(transcript => ({ transcript }));
  result.isFinal = isFinal;
  return result;
}

describe('createRecognition', () => {
  beforeEach(() => {
    recognitionInstances = [];
    vi.stubGlobal('webkitSpeechRecognition', MockSpeechRecognition);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // stop() keeps the session open until the engine has drained its audio
  // buffer, which on a card change is speech from the card being left behind.
  // Aborting ends it immediately so the mic is live again sooner.
  test('exposes restart by aborting the active recognition session', () => {
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];

    recognition.restart();

    expect(native.nativeAbort).toHaveBeenCalledTimes(1);
    expect(native.nativeStop).not.toHaveBeenCalled();
  });

  test('restart falls back to stopping when the engine has no abort', () => {
    vi.stubGlobal('webkitSpeechRecognition', MockSpeechRecognitionWithoutAbort);
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];

    recognition.restart();

    expect(native.nativeStop).toHaveBeenCalledTimes(1);
  });

  test('restart still auto-restarts the recognizer once the session ends', () => {
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];

    recognition.restart();
    // Chrome reports its own abort as an error before ending the session.
    native.onerror({ error: 'aborted' });
    native.onend();

    expect(native.nativeStart).toHaveBeenCalledTimes(1);
    expect(recognition.isPaused()).toBe(false);
  });

  // pause() is not a latency-sensitive path (blur, mute, help panel), and
  // stopping lets any in-flight result finish rather than discarding it.
  test('pause stops rather than aborts', () => {
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];

    recognition.pause();

    expect(native.nativeStop).toHaveBeenCalledTimes(1);
    expect(native.nativeAbort).not.toHaveBeenCalled();
  });

  test('does not auto-restart when paused recognition ends', () => {
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];

    recognition.pause();
    recognition.onend();

    expect(native.nativeStop).toHaveBeenCalledTimes(1);
    expect(native.nativeStart).not.toHaveBeenCalled();
    expect(recognition.isPaused()).toBe(true);
  });

  test('auto-restarts when active recognition ends', () => {
    vi.useFakeTimers();
    try {
      const recognition = createRecognition('ja-JP', vi.fn());
      const native = recognitionInstances[0];

      recognition.start();
      // A session that ran for a while before ending is the engine's ordinary
      // idle timeout, which restarts immediately. Ending instantly instead
      // would be a failed session, and is backed off — see 'restart backoff'.
      vi.advanceTimersByTime(30_000);
      recognition.onend();

      expect(native.nativeStart).toHaveBeenCalledTimes(2);
      expect(recognition.isPaused()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // Requests multiple ranked guesses from the engine: short utterances and
  // common on'yomi are often autocorrected to the wrong real word in the
  // top slot, but the correct reading is frequently further down the list.
  test('requests multiple alternatives from the underlying engine', () => {
    createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];

    expect(native.maxAlternatives).toBeGreaterThan(1);
  });

  test('passes every alternative transcript for a final result', () => {
    const callback = vi.fn();
    createRecognition('ja-JP', callback);
    const native = recognitionInstances[0];

    native.onresult({
      resultIndex: 0,
      results: [makeResult(['かい', '会', '回'], true)],
    });

    expect(callback).toHaveBeenCalledWith(['かい', '会', '回'], true, '0:0');
  });

  test('passes a single alternative for an interim result', () => {
    const callback = vi.fn();
    createRecognition('ja-JP', callback);
    const native = recognitionInstances[0];

    native.onresult({
      resultIndex: 0,
      results: [makeResult(['かい'], false)],
    });

    expect(callback).toHaveBeenCalledWith(['かい'], false, '0:0');
  });

  test('trims whitespace from every alternative', () => {
    const callback = vi.fn();
    createRecognition('ja-JP', callback);
    const native = recognitionInstances[0];

    native.onresult({
      resultIndex: 0,
      results: [makeResult([' かい ', ' 回 '], true)],
    });

    expect(callback).toHaveBeenCalledWith(['かい', '回'], true, '0:0');
  });

  test('processes only results from resultIndex onward', () => {
    const callback = vi.fn();
    createRecognition('ja-JP', callback);
    const native = recognitionInstances[0];

    native.onresult({
      resultIndex: 1,
      results: [makeResult(['stale'], true), makeResult(['fresh'], true)],
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(['fresh'], true, '0:1');
  });

  test('identifies the same result across interim and final updates', () => {
    const callback = vi.fn();
    createRecognition('ja-JP', callback);
    const native = recognitionInstances[0];

    native.onresult({ resultIndex: 0, results: [makeResult(['かい'], false)] });
    native.onresult({ resultIndex: 0, results: [makeResult(['かい'], true)] });

    expect(callback.mock.calls[0][2]).toBe(callback.mock.calls[1][2]);
  });

  test('does not reuse result identities after recognition restarts', () => {
    vi.useFakeTimers();
    try {
      const callback = vi.fn();
      const recognition = createRecognition('ja-JP', callback);
      const native = recognitionInstances[0];

      recognition.start();
      native.onresult({ resultIndex: 0, results: [makeResult(['かい'], true)] });
      vi.advanceTimersByTime(30_000);
      recognition.onend();
      native.onresult({ resultIndex: 0, results: [makeResult(['かい'], true)] });

      expect(callback.mock.calls[0][2]).not.toBe(callback.mock.calls[1][2]);
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression: createRecognition returned null when webkitSpeechRecognition
  // was missing, but nothing checked for it — callers would crash calling
  // .restart()/.pause()/.resume() on null. See setLanguage's null-safety below.
  test('returns null when the browser has no webkitSpeechRecognition', () => {
    vi.unstubAllGlobals();
    expect(createRecognition('ja-JP', vi.fn())).toBeNull();
    vi.stubGlobal('webkitSpeechRecognition', MockSpeechRecognition);
  });

  describe('onError and fatal-error handling', () => {
    test('invokes onError with the native error type', () => {
      const onError = vi.fn();
      createRecognition('ja-JP', vi.fn(), onError);
      const native = recognitionInstances[0];

      native.onerror({ error: 'not-allowed' });

      expect(onError).toHaveBeenCalledWith('not-allowed');
    });

    // 'aborted' is this module's own restart(); reporting it would surface a
    // console error on every card change that swaps the recognizer language.
    test.each(['no-speech', 'aborted'])('does not invoke onError for %s', (errorType) => {
      const onError = vi.fn();
      createRecognition('ja-JP', vi.fn(), onError);
      const native = recognitionInstances[0];

      native.onerror({ error: errorType });

      expect(onError).not.toHaveBeenCalled();
    });

    test.each(['not-allowed', 'service-not-allowed', 'audio-capture'])(
      'stops auto-restart after a %s error',
      (errorType) => {
        const recognition = createRecognition('ja-JP', vi.fn());
        const native = recognitionInstances[0];

        native.onerror({ error: errorType });
        native.onend();

        expect(native.nativeStart).not.toHaveBeenCalled();
        expect(recognition.isPaused()).toBe(true);
      }
    );

    test('does not stop auto-restart for a transient network error', () => {
      const recognition = createRecognition('ja-JP', vi.fn());

      recognitionInstances[0].onerror({ error: 'network' });

      expect(recognition.isPaused()).toBe(false);
    });

    test('backs off before restarting after a network error instead of restarting immediately', () => {
      vi.useFakeTimers();
      try {
        createRecognition('ja-JP', vi.fn());
        const native = recognitionInstances[0];

        native.onerror({ error: 'network' });
        native.onend();

        expect(native.nativeStart).not.toHaveBeenCalled();
        // Bounded rather than runAllTimers: the liveness watchdog runs on an
        // interval, which runAllTimers would spin on forever.
        vi.advanceTimersByTime(2000);
        expect(native.nativeStart).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    test('resets the network backoff once a result comes through', () => {
      vi.useFakeTimers();
      try {
        createRecognition('ja-JP', vi.fn());
        const native = recognitionInstances[0];

        native.onerror({ error: 'network' });
        native.onresult({ resultIndex: 0, results: [makeResult(['かい'], true)] });
        native.onend();

        // No lingering backoff — restarts immediately like the healthy path.
        expect(native.nativeStart).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// ── restart backoff ───────────────────────────────────────────────────────────

describe('restart backoff', () => {
  beforeEach(() => {
    recognitionInstances = [];
    vi.stubGlobal('webkitSpeechRecognition', MockSpeechRecognition);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // The engine ends sessions on its own during silence. Backing those off
  // would leave the mic dead for seconds every time the user stops talking.
  test('restarts immediately after a healthy session ends', () => {
    vi.useFakeTimers();
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];

    recognition.resume();
    native.nativeStart.mockClear();
    vi.advanceTimersByTime(30_000);
    native.onend();

    expect(native.nativeStart).toHaveBeenCalledTimes(1);
  });

  // A session that dies on arrival isn't the idle timeout — it's a failure
  // that will repeat, and restarting it without delay spins.
  test('backs off when a session ends almost as soon as it started', () => {
    vi.useFakeTimers();
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];

    recognition.resume();
    native.nativeStart.mockClear();
    native.onend();

    expect(native.nativeStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(native.nativeStart).toHaveBeenCalledTimes(1);
  });

  test('backoff grows with each consecutive unhealthy session', () => {
    vi.useFakeTimers();
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];
    recognition.resume();

    native.onend();
    vi.advanceTimersByTime(1000);
    native.nativeStart.mockClear();

    // Second immediate end in a row waits longer than the first did.
    native.onend();
    vi.advanceTimersByTime(1000);
    expect(native.nativeStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(native.nativeStart).toHaveBeenCalledTimes(1);
  });

  test('backs off after a non-network error too', () => {
    vi.useFakeTimers();
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    recognition.resume();
    native.nativeStart.mockClear();
    vi.advanceTimersByTime(30_000);
    native.onerror({ error: 'bad-grammar' });
    native.onend();

    expect(native.nativeStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(native.nativeStart).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  // Ordinary silence is not a fault, so it must not accumulate backoff.
  test('does not back off after a no-speech error', () => {
    vi.useFakeTimers();
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];

    recognition.resume();
    native.nativeStart.mockClear();
    vi.advanceTimersByTime(30_000);
    native.onerror({ error: 'no-speech' });
    native.onend();

    expect(native.nativeStart).toHaveBeenCalledTimes(1);
  });

  test('a result clears accumulated backoff', () => {
    vi.useFakeTimers();
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];
    recognition.resume();

    native.onend();
    vi.advanceTimersByTime(1000);
    native.nativeStart.mockClear();

    native.onresult({ resultIndex: 0, results: [makeResult(['かい'], true)] });
    vi.advanceTimersByTime(30_000);
    native.onend();

    expect(native.nativeStart).toHaveBeenCalledTimes(1);
  });
});

// ── liveness watchdog ─────────────────────────────────────────────────────────

describe('liveness watchdog', () => {
  let errorSpy;

  beforeEach(() => {
    recognitionInstances = [];
    vi.stubGlobal('webkitSpeechRecognition', MockSpeechRecognition);
    vi.useFakeTimers();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
  });

  // The failure this exists for: the session stays nominally open while its
  // audio track is dead, so there is no error and no 'end' to react to.
  test('restarts a session that has produced nothing at all', () => {
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];
    recognition.resume();

    vi.advanceTimersByTime(60_000);

    expect(native.nativeAbort).toHaveBeenCalled();
  });

  test('leaves a recognizer alone while it is still producing results', () => {
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];
    recognition.resume();

    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(10_000);
      native.onresult({ resultIndex: 0, results: [makeResult(['かい'], true)] });
    }

    expect(native.nativeAbort).not.toHaveBeenCalled();
  });

  // Capture starting is a sign of life even in total silence, which is what
  // keeps a quiet-but-healthy session from being restarted underneath a user
  // who simply isn't talking.
  test('treats audio capture starting as liveness', () => {
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];
    recognition.resume();

    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(10_000);
      native.onaudiostart();
    }

    expect(native.nativeAbort).not.toHaveBeenCalled();
  });

  // Paused covers muted, hidden/blurred, help panel open, and mic denied —
  // app.ts pauses for all of them, and none should be restarted.
  test('does not restart while paused', () => {
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];
    recognition.pause();
    native.nativeAbort.mockClear();

    vi.advanceTimersByTime(120_000);

    expect(native.nativeAbort).not.toHaveBeenCalled();
  });

  // Resuming after a pause longer than the timeout is not a stall.
  test('gives a fresh window after resuming from a long pause', () => {
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];

    recognition.pause();
    vi.advanceTimersByTime(120_000);
    recognition.resume();
    native.nativeAbort.mockClear();
    vi.advanceTimersByTime(10_000);

    expect(native.nativeAbort).not.toHaveBeenCalled();
  });

  test('does not restart repeatedly once it has fired', () => {
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];
    recognition.resume();

    vi.advanceTimersByTime(60_000);
    expect(native.nativeAbort).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    expect(native.nativeAbort).toHaveBeenCalledTimes(1);
  });
});
