import {
  NATIVE_SPEECH_EVENT,
  answerHints,
  createNativeRecognition,
  getNativeSpeechHandler,
} from '../src/native_recognition';
import type { NativeSpeechEvent } from '../src/native_recognition';
import { createRecognition, setLanguage } from '../src/recognition';

function emit(detail: NativeSpeechEvent): void {
  document.dispatchEvent(new CustomEvent(NATIVE_SPEECH_EVENT, { detail }));
}

function makeHandler() {
  return { postMessage: vi.fn() };
}

describe('getNativeSpeechHandler', () => {
  afterEach(() => {
    delete window.webkit;
  });

  test('returns null outside a native host', () => {
    expect(getNativeSpeechHandler()).toBeNull();
  });

  test('returns the kikoeSpeech message handler when the host exposes it', () => {
    const handler = makeHandler();
    window.webkit = { messageHandlers: { kikoeSpeech: handler } };
    expect(getNativeSpeechHandler()).toBe(handler);
  });

  test('createRecognition prefers the native host over Web Speech', () => {
    const handler = makeHandler();
    window.webkit = { messageHandlers: { kikoeSpeech: handler } };
    const recognition = createRecognition('ja-JP', vi.fn());
    recognition?.resume();
    expect(handler.postMessage).toHaveBeenCalledWith({ type: 'start', lang: 'ja-JP', hints: [] });
  });
});

describe('answerHints', () => {
  test('reading cards hint the accepted readings plus the prompt', () => {
    expect(answerHints({ type: 'reading', prompt: '会', readings: ['かい', 'え'], meanings: ['meeting'] }))
      .toEqual(['かい', 'え', '会']);
  });

  test('meaning cards hint the accepted meanings', () => {
    expect(answerHints({ type: 'meaning', prompt: '会', readings: ['かい'], meanings: ['Meeting', 'Meet'] }))
      .toEqual(['Meeting', 'Meet']);
  });

  test('drops blanks and duplicates, and tolerates missing context', () => {
    expect(answerHints({ type: 'reading', prompt: 'かい', readings: ['かい', ' ', ''] })).toEqual(['かい']);
    expect(answerHints(null)).toEqual([]);
    expect(answerHints({ type: 'meaning' })).toEqual([]);
  });
});

describe('createNativeRecognition', () => {
  test('starts paused and posts start with the live language and hints on resume', () => {
    const handler = makeHandler();
    let lang = 'en-US';
    const recognition = createNativeRecognition(handler, () => lang, vi.fn());
    expect(recognition.isPaused()).toBe(true);

    recognition.setHints?.(['meeting']);
    expect(handler.postMessage).not.toHaveBeenCalled();

    lang = 'ja-JP';
    recognition.resume();
    expect(recognition.isPaused()).toBe(false);
    expect(recognition.lang).toBe('ja-JP');
    expect(handler.postMessage).toHaveBeenLastCalledWith({ type: 'start', lang: 'ja-JP', hints: ['meeting'] });
  });

  test('pause posts stop', () => {
    const handler = makeHandler();
    const recognition = createNativeRecognition(handler, () => 'ja-JP', vi.fn());
    recognition.resume();
    recognition.pause();
    expect(recognition.isPaused()).toBe(true);
    expect(handler.postMessage).toHaveBeenLastCalledWith({ type: 'stop' });
  });

  test('hint changes while listening are pushed to the host, unchanged hints are not', () => {
    const handler = makeHandler();
    const recognition = createNativeRecognition(handler, () => 'ja-JP', vi.fn());
    recognition.resume();
    recognition.setHints?.(['かい']);
    recognition.setHints?.(['かい']);
    expect(handler.postMessage).toHaveBeenCalledTimes(2);
    expect(handler.postMessage).toHaveBeenLastCalledWith({ type: 'hints', hints: ['かい'] });
  });

  test('setLanguage restarts with the new locale', () => {
    const handler = makeHandler();
    let lang = 'ja-JP';
    const recognition = createNativeRecognition(handler, () => lang, vi.fn());
    recognition.resume();
    lang = 'en-US';
    setLanguage(recognition, 'en-US');
    expect(handler.postMessage).toHaveBeenLastCalledWith({ type: 'start', lang: 'en-US', hints: [] });
  });

  test('forwards results with every alternative, trimmed', () => {
    const callback = vi.fn();
    const recognition = createNativeRecognition(makeHandler(), () => 'ja-JP', callback);
    recognition.resume();
    emit({ type: 'result', transcripts: [' 会 ', 'かい', '貝'], isFinal: true, resultId: '3:1' });
    expect(callback).toHaveBeenCalledWith(['会', 'かい', '貝'], true, '3:1');
  });

  test('drops results that arrive while paused', () => {
    const callback = vi.fn();
    const recognition = createNativeRecognition(makeHandler(), () => 'ja-JP', callback);
    emit({ type: 'result', transcripts: ['かい'], isFinal: true, resultId: '1:0' });
    recognition.resume();
    recognition.pause();
    emit({ type: 'result', transcripts: ['かい'], isFinal: false, resultId: '1:1' });
    expect(callback).not.toHaveBeenCalled();
  });

  test('reports errors, and fatal ones leave the recognizer paused', () => {
    const onError = vi.fn();
    const recognition = createNativeRecognition(makeHandler(), () => 'ja-JP', vi.fn(), onError);
    recognition.resume();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    emit({ type: 'error', error: 'network' });
    expect(recognition.isPaused()).toBe(false);

    emit({ type: 'error', error: 'not-allowed' });
    expect(recognition.isPaused()).toBe(true);
    expect(onError.mock.calls).toEqual([['network'], ['not-allowed']]);
  });

  test('a throwing message handler is logged, not thrown', () => {
    const handler = { postMessage: vi.fn(() => { throw new Error('gone'); }) };
    const recognition = createNativeRecognition(handler, () => 'ja-JP', vi.fn());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => recognition.resume()).not.toThrow();
    expect(log).toHaveBeenCalled();
  });
});
