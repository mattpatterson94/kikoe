import { acquireWakeLock, releaseWakeLock } from '../src/wake_lock';

// Mirrors the real WakeLockSentinel: `.released` flips synchronously the
// moment the lock is released — whether by an explicit release() call or,
// via fireReleaseEvent(), the browser's own automatic release (e.g. the
// document going hidden) — and the 'release' event fires alongside it.
function mockSentinel() {
  let released = false;
  const releaseListeners: (() => void)[] = [];
  return {
    get released() { return released; },
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'release') releaseListeners.push(listener);
    },
    release: vi.fn(async () => {
      released = true;
      releaseListeners.forEach((l) => l());
    }),
    fireReleaseEvent: () => {
      released = true;
      releaseListeners.forEach((l) => l());
    },
    // Flips `.released` the way the browser would on its own automatic
    // release, without dispatching the 'release' event yet — lets a test
    // exercise the gap between the two instead of assuming they're atomic.
    markReleasedWithoutEvent: () => { released = true; },
  };
}

afterEach(async () => {
  // Drain any sentinel left acquired by a test so state doesn't leak.
  await releaseWakeLock();
  // @ts-expect-error test-only cleanup of a property tests may have stubbed
  delete navigator.wakeLock;
});

describe('acquireWakeLock', () => {
  test('does nothing when the Wake Lock API is unsupported', async () => {
    await expect(acquireWakeLock()).resolves.toBeUndefined();
  });

  test('requests a screen wake lock when supported', async () => {
    const sentinel = mockSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request };

    await acquireWakeLock();

    expect(request).toHaveBeenCalledWith('screen');
  });

  test('does not request again while a lock is already held', async () => {
    const sentinel = mockSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request };

    await acquireWakeLock();
    await acquireWakeLock();

    expect(request).toHaveBeenCalledTimes(1);
  });

  test('swallows a rejected request (e.g. denied or hidden document)', async () => {
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request: vi.fn().mockRejectedValue(new Error('NotAllowedError')) };

    await expect(acquireWakeLock()).resolves.toBeUndefined();
  });

  test('re-requests after the sentinel fires its release event', async () => {
    const sentinel = mockSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request };

    await acquireWakeLock();
    await sentinel.release();
    await acquireWakeLock();

    expect(request).toHaveBeenCalledTimes(2);
  });

  test('re-requests when the browser auto-released the tracked sentinel before its event ran', async () => {
    // Regression: the guard used to trust a non-null `sentinel` reference
    // even if the browser had already released it (e.g. on the document
    // going hidden) but that sentinel's own 'release' listener — which nulls
    // the module's reference — hadn't been dispatched yet. Checking
    // `.released` directly instead of relying on that listener having run
    // catches this regardless of event-ordering.
    const first = mockSentinel();
    const second = mockSentinel();
    const request = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request };

    await acquireWakeLock();
    first.markReleasedWithoutEvent();

    await acquireWakeLock();

    expect(request).toHaveBeenCalledTimes(2);
  });

  test('two unawaited calls in the same tick only issue one request', async () => {
    // Regression: app.ts's blur/focus/visibilitychange listeners can all
    // fire in the same tick (e.g. switching tabs) and each call
    // acquireWakeLock() without awaiting the previous call.
    const sentinel = mockSentinel();
    let resolveRequest!: (value: unknown) => void;
    const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request };

    const first = acquireWakeLock();
    const second = acquireWakeLock();
    resolveRequest(sentinel);
    await first;
    await second;

    expect(request).toHaveBeenCalledTimes(1);
  });

  test('an acquire sandwiched around a still-pending release ends up held, not released', async () => {
    // Regression: acquire (A1) starts request(), then release (R1) joins the
    // same in-flight step, then acquire (A2) joins it too — all before the
    // request settles. R1 must not clobber the lock A2 asked for once it
    // resolves: the *last* call was an acquire, so the end state must be
    // held.
    const sentinel = mockSentinel();
    let resolveRequest!: (value: unknown) => void;
    const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request };

    const a1 = acquireWakeLock();
    const r1 = releaseWakeLock();
    const a2 = acquireWakeLock();
    resolveRequest(sentinel);
    await Promise.all([a1, r1, a2]);

    expect(sentinel.release).not.toHaveBeenCalled();
    // A later release proves the module still thinks it's holding the lock.
    await releaseWakeLock();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });
});

describe('releaseWakeLock', () => {
  test('is a no-op when nothing is held', async () => {
    await expect(releaseWakeLock()).resolves.toBeUndefined();
  });

  test('releases a held sentinel', async () => {
    const sentinel = mockSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request };

    await acquireWakeLock();
    await releaseWakeLock();

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  test('a subsequent acquire requests a fresh lock', async () => {
    const sentinel = mockSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request };

    await acquireWakeLock();
    await releaseWakeLock();
    await acquireWakeLock();

    expect(request).toHaveBeenCalledTimes(2);
  });

  test('waits for a concurrent in-flight acquire instead of orphaning the lock it grants', async () => {
    const sentinel = mockSentinel();
    let resolveRequest!: (value: unknown) => void;
    const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request };

    const acquiring = acquireWakeLock();
    const releasing = releaseWakeLock();
    resolveRequest(sentinel);
    await acquiring;
    await releasing;

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  test('a release sandwiched around a still-pending acquire ends up released, not held', async () => {
    // Mirror of the acquire-sandwich case above: release (R1) joins the
    // in-flight step from acquire (A1), then acquire (A2) joins too, then a
    // final release (R2) — the last call was a release, so once the request
    // settles the newly granted lock must be released, not kept.
    const sentinel = mockSentinel();
    let resolveRequest!: (value: unknown) => void;
    const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request };

    const a1 = acquireWakeLock();
    const r1 = releaseWakeLock();
    const a2 = acquireWakeLock();
    const r2 = releaseWakeLock();
    resolveRequest(sentinel);
    await Promise.all([a1, r1, a2, r2]);

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  test('a stale release event from a superseded sentinel does not clobber the current lock', async () => {
    const sentinelA = mockSentinel();
    const sentinelB = mockSentinel();
    const request = vi.fn()
      .mockResolvedValueOnce(sentinelA)
      .mockResolvedValueOnce(sentinelB);
    // @ts-expect-error jsdom has no navigator.wakeLock by default
    navigator.wakeLock = { request };

    await acquireWakeLock();
    await releaseWakeLock();
    await acquireWakeLock(); // now holding sentinelB

    // A late/duplicate 'release' event for the already-superseded sentinelA
    // must not null out the tracked sentinelB.
    sentinelA.fireReleaseEvent();
    await releaseWakeLock();

    expect(sentinelB.release).toHaveBeenCalledTimes(1);
  });
});
