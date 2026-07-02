import { setDebugLogging } from './logger.js';

export const defaults = {
  debug: false,
  customCorrections: [],
  turbo: true,
  speed_show_info: true,
  ippatsu_meaning: false,
  ippatsu_reading: false,
  transcript: true,
  transcript_theme: 'system',
  transcript_position: 'top',
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

export function isTurboOn() {
  return _settings.turbo;
}
