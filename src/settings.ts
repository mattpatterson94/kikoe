import { setDebugLogging } from './logger';

// User-defined speech corrections: replace a persistently misheard
// transcript with the intended answer (see src/flashcards.js).
export interface Correction {
  heard: string;
  intended: string;
}

import type { Site } from './site';

export interface Settings {
  debug: boolean;
  // Which sites Kikoe runs on (Settings → Apps on iOS). Read by content.ts
  // at page load; the native app keeps its own list and ignores these.
  site_wanikani: boolean;
  site_bunpro: boolean;
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
  // See checkAnswer in src/flashcards.ts.
  strict_kanji_readings: boolean;
  // Web Speech recognizer options (Chrome; hidden where unsupported). The
  // native app has its own engine, hint and noise switches and ignores these.
  // 'on_device' asks for processLocally; contextual hints only work there.
  recognizer: 'cloud' | 'on_device';
  contextual_hints: boolean;
  noise_reduction: boolean;
  // Not user-facing: flipped to true (via content.ts) after the one-time
  // help-discovery hint has been shown, so it never reappears.
  help_hint_shown: boolean;
}

export const defaults: Settings = {
  debug: false,
  site_wanikani: true,
  site_bunpro: true,
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
  strict_kanji_readings: true,
  recognizer: 'cloud',
  contextual_hints: true,
  noise_reduction: false,
  help_hint_shown: false,
};

export function isSiteEnabled(settings: Pick<Settings, 'site_wanikani' | 'site_bunpro'>, site: Site): boolean {
  return site === 'wanikani' ? settings.site_wanikani !== false : settings.site_bunpro !== false;
}

// Settings that can differ between WaniKani and BunPro, matching the iOS and
// macOS app (ios/KikoeApp/SiteSettings.swift). An app's own value is stored
// in the sync area as `<site>:<key>`, e.g. `bunpro:transcript_position`;
// without one the plain key applies, so older settings keep working for both.
// Page code never sees the prefixes: content.ts hands each page its own
// app's values under the plain keys.
export const SITE_SETTING_KEYS = [
  'turbo', 'speed_show_info', 'ippatsu_meaning', 'ippatsu_reading',
  'transcript', 'transcript_theme', 'transcript_position', 'show_help_button',
  'strict_kanji_readings',
] as const satisfies readonly (keyof Settings)[];

export type SiteSettingKey = typeof SITE_SETTING_KEYS[number];

const siteSettingKeys: ReadonlySet<string> = new Set(SITE_SETTING_KEYS);

export function siteSettingKey(key: SiteSettingKey, site: Site): string {
  return `${site}:${key}`;
}

/** `<site>:<key>` split into its parts, or null for any other key. */
export function splitSiteSettingKey(key: string): { site: Site; base: string } | null {
  const match = /^(wanikani|bunpro):(.+)$/.exec(key);
  if (!match) return null;
  return { site: match[1] === 'wanikani' ? 'wanikani' : 'bunpro', base: match[2] };
}

/** Stored sync values as `site`'s page should see them: its overrides laid
 *  over the plain keys, and nobody's prefixed keys left in. */
export function applySiteOverrides(stored: Record<string, unknown>, site: Site): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!splitSiteSettingKey(key)) out[key] = value;
  }
  for (const key of SITE_SETTING_KEYS) {
    const override = stored[siteSettingKey(key, site)];
    if (override !== undefined) out[key] = override;
  }
  return out;
}

export interface StorageChange { oldValue?: unknown; newValue?: unknown }

/** chrome.storage.onChanged changes as `site`'s page should see them: its own
 *  overrides become changes to the plain key, other apps' are dropped, and a
 *  plain key it overrides is left alone. `stored` is the sync area after the
 *  change. */
export function relaySiteChanges(
  changes: Record<string, StorageChange>,
  stored: Record<string, unknown>,
  site: Site,
): Record<string, StorageChange> {
  const out: Record<string, StorageChange> = {};
  for (const [key, change] of Object.entries(changes)) {
    const split = splitSiteSettingKey(key);
    if (split) {
      if (split.site !== site || !siteSettingKeys.has(split.base)) continue;
      // A removed override falls back to the plain setting.
      out[split.base] = change.newValue !== undefined ? change : { newValue: stored[split.base] };
    } else if (siteSettingKeys.has(key) && stored[siteSettingKey(key as SiteSettingKey, site)] !== undefined) {
      continue;
    } else {
      out[key] = change;
    }
  }
  return out;
}

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
