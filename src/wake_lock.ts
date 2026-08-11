// The Screen Wake Lock API keeps the display from dimming or auto-locking
// while a hands-free review session is running. Without it, the OS idle
// timer (which only resets on touch/mouse input) blanks the screen mid-review
// and defeats the "no hands required" flow the extension exists for.
//
// The browser releases the lock automatically whenever the document goes
// hidden, so callers must re-request it on every resume rather than treating
// a successful request as durable.
let sentinel: WakeLockSentinel | null = null;

// updateRecognitionForPageActivity in app.ts fires from 'blur', 'focus', and
// 'visibilitychange' listeners that can all run back-to-back in the same
// tick (e.g. switching tabs), each calling acquireWakeLock() without
// awaiting the previous call. Tracking the in-flight request here lets a
// second call join it instead of racing its own request() past the
// `sentinel` guard before the first one resolves.
let inFlight: Promise<void> | null = null;

export function acquireWakeLock(): Promise<void> {
  if (sentinel || !navigator.wakeLock) return Promise.resolve();
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const acquired = await navigator.wakeLock.request('screen');
      acquired.addEventListener('release', () => {
        // A release firing for a sentinel that isn't the one currently
        // tracked (e.g. it was superseded and later released independently)
        // must not clobber the current lock's reference.
        if (sentinel === acquired) sentinel = null;
      });
      sentinel = acquired;
    } catch {
      // Unsupported, denied, or the document isn't visible right now — voice
      // review still works without it, so there's nothing to surface to the
      // user.
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export async function releaseWakeLock(): Promise<void> {
  // Let a concurrent acquire finish first, otherwise the lock it's about to
  // assign to `sentinel` would be orphaned — never released — the moment
  // after this function returns.
  if (inFlight) await inFlight;

  const current = sentinel;
  sentinel = null;
  if (!current) return;
  try {
    await current.release();
  } catch {
    // Already released.
  }
}
