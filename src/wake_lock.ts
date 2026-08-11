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
// tick (e.g. switching tabs), each calling acquireWakeLock()/releaseWakeLock()
// without awaiting the previous call. Two mechanisms make that safe:
//
// 1. `desired` records only the *latest* intent. Callers don't queue "do an
//    acquire" / "do a release" — they set what state is wanted and ask for a
//    sync, so a call overtaken by a later one before it runs just re-applies
//    the newer intent instead of undoing it.
// 2. `pending` serializes the actual work (the request()/release() calls) so
//    only one is ever in flight, and each step reads `desired` at the moment
//    it *runs* rather than trusting a value captured when it was queued —
//    otherwise an acquire queued before a release, but resolving after it,
//    could re-grant a lock the caller has since asked to release (or the
//    reverse).
let desired: 'held' | 'released' = 'released';

// null when idle (no step queued or running). Kept distinct from "resolved
// promise" so a call arriving while idle can start its step synchronously —
// chaining onto an already-settled promise via .then() would still defer to
// a microtask, which is one tick too late for a caller that fires two calls
// back-to-back and expects the first to have already reached its own first
// await (e.g. the request() call landing) before the second runs.
let pending: Promise<void> | null = null;

function sync(): Promise<void> {
  return desired === 'held' ? holdLock() : dropLock();
}

async function holdLock(): Promise<void> {
  // `.released` is authoritative and synchronous, unlike waiting for this
  // sentinel's own 'release' listener to have run — the browser may auto-
  // release a lock (e.g. the document just went hidden) before that
  // listener fires relative to whatever queued this sync.
  if ((sentinel && !sentinel.released) || !navigator.wakeLock) return;
  try {
    const acquired = await navigator.wakeLock.request('screen');
    // The desired state may have flipped to 'released' while the request
    // was in flight; honor the latest intent rather than the one that
    // queued this step.
    if (desired !== 'held') {
      await acquired.release().catch(() => {});
      return;
    }
    acquired.addEventListener('release', () => {
      if (sentinel === acquired) sentinel = null;
    });
    sentinel = acquired;
  } catch {
    // Unsupported, denied, or the document isn't visible right now — voice
    // review still works without it, so there's nothing to surface to the
    // user.
  }
}

async function dropLock(): Promise<void> {
  const current = sentinel;
  sentinel = null;
  if (!current || current.released) return;
  try {
    await current.release();
  } catch {
    // Already released.
  }
}

function enqueue(): Promise<void> {
  // Both success and failure continuations run `sync`, so one step
  // throwing (it shouldn't — both branches catch internally) can't stall
  // every later call permanently behind a rejected chain.
  const step = pending ? pending.then(sync, sync) : sync();
  pending = step;
  step.finally(() => { if (pending === step) pending = null; });
  return step;
}

export function acquireWakeLock(): Promise<void> {
  desired = 'held';
  return enqueue();
}

export function releaseWakeLock(): Promise<void> {
  desired = 'released';
  return enqueue();
}
