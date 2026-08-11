import { acquireWakeLock, releaseWakeLock } from '../src/wake_lock';

function mockSentinel() {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    released: false,
    addEventListener: (type: string, listener: () => void) => {
      (listeners[type] ??= []).push(listener);
    },
    release: vi.fn(async function (this: { released: boolean }) {
      this.released = true;
      listeners.release?.forEach((l) => l());
    }),
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
});
