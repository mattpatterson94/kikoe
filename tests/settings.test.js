import { defaults, initSettings, updateSettings, getSettings, isTurboOn } from '../src/settings';

// Reset module state between tests by re-calling initSettings with defaults.
beforeEach(() => {
  initSettings({ ...defaults });
});

describe('defaults', () => {
  test('turbo is on by default', () => {
    expect(defaults.turbo).toBe(true);
  });

  test('transcript is on by default', () => {
    expect(defaults.transcript).toBe(true);
  });

  test('speed_show_info is on by default', () => {
    expect(defaults.speed_show_info).toBe(true);
  });

  test('debug is off by default', () => {
    expect(defaults.debug).toBe(false);
  });

  test('customCorrections is an empty list by default', () => {
    expect(defaults.customCorrections).toEqual([]);
  });

  test('all expected keys are present', () => {
    const keys = ['debug', 'customCorrections', 'turbo', 'speed_show_info',
      'transcript', 'transcript_theme', 'transcript_position'];
    for (const k of keys) expect(defaults).toHaveProperty(k);
  });
});

describe('initSettings', () => {
  test('applies provided values', () => {
    initSettings({ turbo: true });
    expect(getSettings().turbo).toBe(true);
  });

  test('fills missing keys with defaults', () => {
    initSettings({ turbo: true });
    expect(getSettings().transcript).toBe(defaults.transcript);
  });

  test('overrides all defaults when full object provided', () => {
    initSettings({ ...defaults, turbo: true });
    expect(getSettings().turbo).toBe(true);
  });
});

describe('updateSettings', () => {
  test('replaces current settings', () => {
    initSettings({ turbo: false });
    updateSettings({ ...defaults, turbo: true });
    expect(getSettings().turbo).toBe(true);
  });

  test('fills missing keys with defaults on update', () => {
    updateSettings({ turbo: true });
    expect(getSettings().transcript).toBe(defaults.transcript);
  });
});

describe('isTurboOn', () => {
  test('returns false when turbo is off', () => {
    initSettings({ turbo: false });
    expect(isTurboOn()).toBe(false);
  });

  test('returns true when turbo is on', () => {
    initSettings({ turbo: true });
    expect(isTurboOn()).toBe(true);
  });
});
