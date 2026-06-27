import { createRecognition } from '../src/recognition.js';

let recognitionInstances;

class MockSpeechRecognition {
  constructor() {
    this.continuous = false;
    this.interimResults = false;
    this.lang = '';
    this.nativeStart = vi.fn();
    this.nativeStop = vi.fn();
    this.start = this.nativeStart;
    this.stop = this.nativeStop;
    recognitionInstances.push(this);
  }
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
});
