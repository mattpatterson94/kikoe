import { defaults, initSettings, updateSettings, getSettings, isTurboOn, encodeConfig, decodeConfig } from '../src/settings';

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

  test('show_help_button is on by default', () => {
    expect(defaults.show_help_button).toBe(true);
  });

  test('help_hint_shown is off by default (the one-time hint has not been seen)', () => {
    expect(defaults.help_hint_shown).toBe(false);
  });

  test('all expected keys are present', () => {
    const keys = ['debug', 'customCorrections', 'turbo', 'speed_show_info',
      'reading_recognition_mode', 'transcript', 'transcript_theme', 'transcript_position',
      'show_help_button', 'help_hint_shown'];
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

describe('config encoding', () => {
  test('round-trips settings containing non-Latin1 characters', () => {
    // Regression: the config stamp used btoa(), which throws
    // InvalidCharacterError on Japanese — e.g. a custom correction like
    // じじつ→じりつ killed the content script on every page.
    const config = {
      base: 'chrome-extension://abc/',
      hasApiToken: true,
      settings: {
        ...defaults,
        customCorrections: [{ heard: 'じじつ', intended: 'じりつ' }],
      },
    };
    expect(decodeConfig(encodeConfig(config))).toEqual(config);
  });

  test('decodeConfig returns null for missing or malformed input', () => {
    expect(decodeConfig(undefined)).toBeNull();
    expect(decodeConfig('')).toBeNull();
    expect(decodeConfig('not json {')).toBeNull();
  });
});
