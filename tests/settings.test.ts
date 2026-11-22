import { defaults, initSettings, updateSettings, getSettings, isTurboOn, encodeConfig, decodeConfig, isSiteEnabled,
  SITE_SETTING_KEYS, siteSettingKey, splitSiteSettingKey, applySiteOverrides, relaySiteChanges } from '../src/settings';

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

  test('keep_screen_awake is on by default', () => {
    expect(defaults.keep_screen_awake).toBe(true);
  });

  test('help_hint_shown is off by default (the one-time hint has not been seen)', () => {
    expect(defaults.help_hint_shown).toBe(false);
  });

  test('all expected keys are present', () => {
    const keys = ['debug', 'customCorrections', 'turbo', 'speed_show_info',
      'transcript', 'transcript_theme', 'transcript_position',
      'show_help_button', 'keep_screen_awake', 'help_hint_shown'];
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

describe('isSiteEnabled', () => {
  test('both sites are on by default', () => {
    expect(isSiteEnabled(defaults, 'wanikani')).toBe(true);
    expect(isSiteEnabled(defaults, 'bunpro')).toBe(true);
  });

  test('each site follows its own toggle', () => {
    const settings = { site_wanikani: false, site_bunpro: true };
    expect(isSiteEnabled(settings, 'wanikani')).toBe(false);
    expect(isSiteEnabled(settings, 'bunpro')).toBe(true);
  });
});

describe('recognizer defaults', () => {
  test('keep the existing Web Speech behaviour until turned on', () => {
    expect(defaults.recognizer).toBe('cloud');
    expect(defaults.noise_reduction).toBe(false);
    expect(defaults.contextual_hints).toBe(true);
  });
});

describe('per-app settings', () => {
  test('keys are prefixed with the site', () => {
    expect(siteSettingKey('turbo', 'bunpro')).toBe('bunpro:turbo');
    expect(splitSiteSettingKey('wanikani:transcript')).toEqual({ site: 'wanikani', base: 'transcript' });
    expect(splitSiteSettingKey('turbo')).toBeNull();
    expect(splitSiteSettingKey('other:turbo')).toBeNull();
  });

  test('matches the iOS app\'s list of per-app keys', () => {
    expect([...SITE_SETTING_KEYS].sort()).toEqual([
      'ippatsu_meaning', 'ippatsu_reading', 'show_help_button', 'speed_show_info',
      'strict_kanji_readings', 'transcript', 'transcript_position', 'transcript_theme', 'turbo',
    ]);
  });

  test('applySiteOverrides lays the site\'s values over the plain keys and drops prefixed keys', () => {
    const stored = { turbo: true, debug: true, 'bunpro:turbo': false, 'wanikani:transcript': false };
    expect(applySiteOverrides(stored, 'bunpro')).toEqual({ turbo: false, debug: true });
    expect(applySiteOverrides(stored, 'wanikani')).toEqual({ turbo: true, debug: true, transcript: false });
  });

  test('relaySiteChanges turns own overrides into plain-key changes and drops other sites\'', () => {
    const stored = { turbo: true, 'bunpro:turbo': false };
    expect(relaySiteChanges({ 'bunpro:turbo': { newValue: false } }, stored, 'bunpro'))
      .toEqual({ turbo: { newValue: false } });
    expect(relaySiteChanges({ 'bunpro:turbo': { newValue: false } }, stored, 'wanikani')).toEqual({});
  });

  test('relaySiteChanges ignores a plain key the site overrides, but passes it on otherwise', () => {
    const stored = { turbo: false, 'bunpro:turbo': true };
    expect(relaySiteChanges({ turbo: { newValue: false } }, stored, 'bunpro')).toEqual({});
    expect(relaySiteChanges({ turbo: { newValue: false } }, stored, 'wanikani')).toEqual({ turbo: { newValue: false } });
    expect(relaySiteChanges({ debug: { newValue: true } }, stored, 'bunpro')).toEqual({ debug: { newValue: true } });
  });

  test('a removed override falls back to the plain setting', () => {
    const stored = { transcript_position: 'top' };
    expect(relaySiteChanges({ 'bunpro:transcript_position': { oldValue: 'bottom' } }, stored, 'bunpro'))
      .toEqual({ transcript_position: { newValue: 'top' } });
  });
});
