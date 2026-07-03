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
    this.start = this.nativeStart;
    this.stop = this.nativeStop;
    recognitionInstances.push(this);
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

  test('exposes restart by stopping the active recognition session', () => {
    const recognition = createRecognition('ja-JP', vi.fn());

    recognition.restart();

    expect(recognition.stop).toHaveBeenCalledTimes(1);
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
    const recognition = createRecognition('ja-JP', vi.fn());
    const native = recognitionInstances[0];

    recognition.start();
    recognition.onend();

    expect(native.nativeStart).toHaveBeenCalledTimes(2);
    expect(recognition.isPaused()).toBe(false);
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

    expect(callback).toHaveBeenCalledWith(['かい', '会', '回'], true);
  });

  test('passes a single alternative for an interim result', () => {
    const callback = vi.fn();
    createRecognition('ja-JP', callback);
    const native = recognitionInstances[0];

    native.onresult({
      resultIndex: 0,
      results: [makeResult(['かい'], false)],
    });

    expect(callback).toHaveBeenCalledWith(['かい'], false);
  });

  test('trims whitespace from every alternative', () => {
    const callback = vi.fn();
    createRecognition('ja-JP', callback);
    const native = recognitionInstances[0];

    native.onresult({
      resultIndex: 0,
      results: [makeResult([' かい ', ' 回 '], true)],
    });

    expect(callback).toHaveBeenCalledWith(['かい', '回'], true);
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
    expect(callback).toHaveBeenCalledWith(['fresh'], true);
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

    test('does not invoke onError for no-speech', () => {
      const onError = vi.fn();
      createRecognition('ja-JP', vi.fn(), onError);
      const native = recognitionInstances[0];

      native.onerror({ error: 'no-speech' });

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
        vi.runAllTimers();
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
