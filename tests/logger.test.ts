import { debugLog, setDebugLogging, isDebugLoggingEnabled } from '../src/logger';
import { initSettings, updateSettings } from '../src/settings';
import type { MockInstance } from 'vitest';

let logSpy: MockInstance;

beforeEach(() => {
  setDebugLogging(false);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

describe('debugLog', () => {
  test('is silent by default', () => {
    debugLog('hello');
    expect(logSpy).not.toHaveBeenCalled();
  });

  test('logs with the [kikoe] prefix when enabled', () => {
    setDebugLogging(true);
    debugLog('checkAnswer', { raw: 'ねこ' });
    expect(logSpy).toHaveBeenCalledWith('[kikoe]', 'checkAnswer', { raw: 'ねこ' });
  });

  test('goes silent again when disabled', () => {
    setDebugLogging(true);
    setDebugLogging(false);
    debugLog('hello');
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('isDebugLoggingEnabled', () => {
  test('reflects the current flag', () => {
    expect(isDebugLoggingEnabled()).toBe(false);
    setDebugLogging(true);
    expect(isDebugLoggingEnabled()).toBe(true);
  });

  test('coerces truthy values to booleans', () => {
    setDebugLogging(1);
    expect(isDebugLoggingEnabled()).toBe(true);
    setDebugLogging(undefined);
    expect(isDebugLoggingEnabled()).toBe(false);
  });
});

describe('settings integration', () => {
  test('initSettings enables debug logging', () => {
    initSettings({ debug: true });
    debugLog('enabled via settings');
    expect(logSpy).toHaveBeenCalledWith('[kikoe]', 'enabled via settings');
  });

  test('updateSettings toggles debug logging off', () => {
    initSettings({ debug: true });
    updateSettings({ debug: false });
    debugLog('should not appear');
    expect(logSpy).not.toHaveBeenCalled();
  });

  test('initSettings without debug key leaves it off', () => {
    initSettings({ turbo: true });
    debugLog('should not appear');
    expect(logSpy).not.toHaveBeenCalled();
  });
});
