// Debug-mode console logging. Verbose diagnostics (answer matching, pending
// transcripts, API token discovery, enhancer attachment) go through debugLog
// so the console stays quiet unless the user enables the `debug` setting.
// Warnings and errors are always logged directly via console.warn/error.
//
// Both bundles (page bundle via src/settings.js, content script via
// extension/content.js) hold their own copy of this module's state and set
// it from the same `debug` setting.
let _debug = false;

export function setDebugLogging(enabled) {
  _debug = !!enabled;
}

export function isDebugLoggingEnabled() {
  return _debug;
}

export function debugLog(...args) {
  if (_debug) console.log('[kikoe]', ...args);
}
