import { setDebugLogging } from './logger.js';

export const defaults = {
  debug: false,
  lightning: false,
  lightning_delay: 0.1,
  mistake_delay: 0.1,
  speed_show_info: true,
  transcript: true,
  transcript_theme: 'system',
  transcript_position: 'top',
  transcript_delay: 5,
  transcript_count: 1,
  transcript_clear: false,
};

// In the page-context bundle, settings are pushed in from the content script
// via initSettings() at startup and updateSettings() on change events.
let _settings = { ...defaults };

export function initSettings(settings) {
  _settings = { ...defaults, ...settings };
  setDebugLogging(_settings.debug);
}

export function updateSettings(settings) {
  _settings = { ...defaults, ...settings };
  setDebugLogging(_settings.debug);
}

export function getSettings() {
  return _settings;
}

export function isLightningOn() {
  return _settings.lightning;
}
