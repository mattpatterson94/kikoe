// SpeechRecognition only reports a missing/revoked microphone permission
// reactively — after start() has already been called and failed — so a
// permission revoked while nothing is actively listening (e.g. the tab is
// hidden, or the OS/browser revoked it out from under an already-"granted"
// grant) leaves the idle indicator showing "Listening" with nothing behind
// it (see issue #78). The Permissions API lets us ask directly instead of
// waiting for that failure.
//
// Not every browser that supports webkitSpeechRecognition also supports
// querying the 'microphone' permission name (and jsdom/test environments
// have neither) — callers must keep working with permission state unknown,
// which is why onChange is best-effort and this silently no-ops when the
// API/name isn't available.
const RECHECK_INTERVAL_MS = 15000;

export function watchMicPermission(onChange: (state: PermissionState) => void): void {
  if (!navigator.permissions?.query) return;

  navigator.permissions.query({ name: 'microphone' as PermissionName })
    .then((status) => {
      onChange(status.state);
      status.onchange = () => onChange(status.state);
      // 'onchange' isn't reliably fired for microphone on every browser/OS
      // combination (e.g. access pulled via OS-level privacy settings rather
      // than the browser's own permission UI) — poll as a backstop so the
      // indicator can't be stuck lying indefinitely.
      setInterval(() => onChange(status.state), RECHECK_INTERVAL_MS);
    })
    .catch(() => {
      // 'microphone' isn't a recognized PermissionName on this browser.
    });
}
