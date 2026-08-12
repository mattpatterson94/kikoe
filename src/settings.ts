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
  show_help_button: boolean;
  keep_screen_awake: boolean;
  // Experimental. See checkAnswer in src/flashcards.ts.
  strict_kanji_readings: boolean;
  // Not user-facing: flipped to true (via content.ts) after the one-time
  // help-discovery hint has been shown, so it never reappears.
  help_hint_shown: boolean;
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
  show_help_button: true,
  keep_screen_awake: true,
  strict_kanji_readings: false,
  help_hint_shown: false,
};

// The config travels from the content script to the page bundle as plain
// JSON in a data attribute — the DOM stores any Unicode losslessly, whereas
// btoa() throws on non-Latin1 (e.g. Japanese custom corrections).
export function encodeConfig(config: unknown): string {
  return JSON.stringify(config);
}

export function decodeConfig<T>(encoded: string | undefined): T | null {
  if (!encoded) return null;
  try {
    return JSON.parse(encoded) as T;
  } catch {
    return null;
  }
}

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
