// The Screen Wake Lock API keeps the display from dimming or auto-locking
// while a hands-free review session is running. Without it, the OS idle
// timer (which only resets on touch/mouse input) blanks the screen mid-review
// and defeats the "no hands required" flow the extension exists for.
//
// The browser releases the lock automatically whenever the document goes
// hidden, so callers must re-request it on every resume rather than treating
// a successful request as durable.
let sentinel: WakeLockSentinel | null = null;

export async function acquireWakeLock(): Promise<void> {
  if (sentinel || !navigator.wakeLock) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch {
    // Unsupported, denied, or the document isn't visible right now — voice
    // review still works without it, so there's nothing to surface to the
    // user.
    sentinel = null;
  }
}

export async function releaseWakeLock(): Promise<void> {
  const current = sentinel;
  sentinel = null;
  if (!current) return;
  try {
    await current.release();
  } catch {
    // Already released.
  }
}
