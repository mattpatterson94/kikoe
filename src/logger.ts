// Debug-mode console logging. Verbose diagnostics (answer matching, pending
// transcripts, API token discovery, enhancer attachment) go through debugLog
// so the console stays quiet unless the user enables the `debug` setting.
// Warnings and errors are always logged directly via console.warn/error.
//
// Both bundles (page bundle via src/settings.ts, content script via
// extension/content.js) hold their own copy of this module's state and set
// it from the same `debug` setting.
let _debug = false;

// Accepts any value: settings arrive from storage/config payloads, so the
// flag is coerced rather than trusted to be a boolean.
export function setDebugLogging(enabled: unknown): void {
  _debug = !!enabled;
}

export function isDebugLoggingEnabled(): boolean {
  return _debug;
}

export function debugLog(...args: unknown[]): void {
  if (_debug) console.log('[kikoe]', ...args);
}
