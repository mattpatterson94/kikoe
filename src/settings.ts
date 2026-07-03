import { setDebugLogging } from './logger';

// User-defined speech corrections: replace a persistently misheard
// transcript with the intended answer (see src/flashcards.js).
export interface Correction {
  heard: string;
  intended: string;
}

export interface Settings {
  debug: boolean;
  customCorrections: Correction[];
  turbo: boolean;
  speed_show_info: boolean;
  ippatsu_meaning: boolean;
  ippatsu_reading: boolean;
  transcript: boolean;
  transcript_theme: 'system' | 'light' | 'dark';
  transcript_position: 'top' | 'bottom';
}

export const defaults: Settings = {
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
let _settings: Settings = { ...defaults };

export function initSettings(settings: Partial<Settings>): void {
  _settings = { ...defaults, ...settings };
  setDebugLogging(_settings.debug);
}

export function updateSettings(settings: Partial<Settings>): void {
  _settings = { ...defaults, ...settings };
  setDebugLogging(_settings.debug);
}

export function getSettings(): Settings {
  return _settings;
}

export function isTurboOn(): boolean {
  return _settings.turbo;
}
