import { defaults, initSettings, updateSettings, getSettings, isLightningOn } from '../src/settings.js';

// Reset module state between tests by re-calling initSettings with defaults.
beforeEach(() => {
  initSettings({ ...defaults });
});

describe('defaults', () => {
  test('lightning is off by default', () => {
    expect(defaults.lightning).toBe(false);
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

  test('all expected keys are present', () => {
    const keys = ['debug', 'lightning', 'lightning_delay', 'mistake_delay', 'speed_show_info',
      'transcript', 'transcript_theme',
      'transcript_position', 'transcript_delay', 'transcript_count',
      'transcript_clear'];
    for (const k of keys) expect(defaults).toHaveProperty(k);
  });
});

describe('initSettings', () => {
  test('applies provided values', () => {
    initSettings({ lightning: true, transcript_delay: 10 });
    expect(getSettings().lightning).toBe(true);
    expect(getSettings().transcript_delay).toBe(10);
  });

  test('fills missing keys with defaults', () => {
    initSettings({ lightning: true });
    expect(getSettings().transcript).toBe(defaults.transcript);
    expect(getSettings().transcript_delay).toBe(defaults.transcript_delay);
  });

  test('overrides all defaults when full object provided', () => {
    initSettings({ ...defaults, lightning: true });
    expect(getSettings().lightning).toBe(true);
  });
});

describe('updateSettings', () => {
  test('replaces current settings', () => {
    initSettings({ lightning: false });
    updateSettings({ ...defaults, lightning: true, transcript_delay: 99 });
    expect(getSettings().lightning).toBe(true);
    expect(getSettings().transcript_delay).toBe(99);
  });

  test('fills missing keys with defaults on update', () => {
    updateSettings({ lightning: true });
    expect(getSettings().transcript).toBe(defaults.transcript);
  });
});

describe('isLightningOn', () => {
  test('returns false when lightning is off', () => {
    initSettings({ lightning: false });
    expect(isLightningOn()).toBe(false);
  });

  test('returns true when lightning is on', () => {
    initSettings({ lightning: true });
    expect(isLightningOn()).toBe(true);
  });
});
