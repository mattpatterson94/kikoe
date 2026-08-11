import { acquireWakeLock, releaseWakeLock } from '../src/wake_lock';

function mockSentinel() {
  const releaseListeners: (() => void)[] = [];
  return {
    released: false,
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'release') releaseListeners.push(listener);
    },
    release: vi.fn(async function (this: { released: boolean }) {
      this.released = true;
      releaseListeners.forEach((l) => l());
    }),
    // Fires the 'release' listener(s) directly, without going through
    // release() — simulates the browser's own auto-release (e.g. the
    // document going hidden) rather than an explicit releaseWakeLock() call.
    fireReleaseEvent: () => releaseListeners.forEach((l) => l()),
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

  test('two unawaited calls in the same tick only issue one request', async () => {
    // Regression: app.ts's blur/focus/visibilitychange listeners can all
    // fire in the same tick (e.g. switching tabs) and each call
    // acquireWakeLock() without awaiting the previous call. Both used to
    // pass the `if (sentinel) return` guard before the first request()
    // settled, issuing two requests and losing track of one sentinel.
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
