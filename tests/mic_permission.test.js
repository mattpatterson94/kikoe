import { watchMicPermission } from '../src/mic_permission';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('watchMicPermission', () => {
  test('does nothing when the Permissions API is unavailable', () => {
    vi.stubGlobal('navigator', {});
    const onChange = vi.fn();

    expect(() => watchMicPermission(onChange)).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('does nothing when the query rejects (e.g. unrecognized permission name)', async () => {
    const query = vi.fn(() => Promise.reject(new Error('nope')));
    vi.stubGlobal('navigator', { permissions: { query } });
    const onChange = vi.fn();

    watchMicPermission(onChange);
    await vi.waitFor(() => expect(query).toHaveBeenCalledWith({ name: 'microphone' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('reports the current state immediately on resolution', async () => {
    const status = { state: 'denied', onchange: null };
    vi.stubGlobal('navigator', { permissions: { query: vi.fn(() => Promise.resolve(status)) } });
    const onChange = vi.fn();

    watchMicPermission(onChange);

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('denied'));
  });

  test('reports a later change via the PermissionStatus onchange event', async () => {
    const status = { state: 'denied', onchange: null };
    vi.stubGlobal('navigator', { permissions: { query: vi.fn(() => Promise.resolve(status)) } });
    const onChange = vi.fn();

    watchMicPermission(onChange);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('denied'));

    status.state = 'granted';
    status.onchange();

    expect(onChange).toHaveBeenLastCalledWith('granted');
  });

  test('polls on an interval as a backstop when onchange never fires', async () => {
    vi.useFakeTimers();
    const status = { state: 'granted', onchange: null };
    vi.stubGlobal('navigator', { permissions: { query: vi.fn(() => Promise.resolve(status)) } });
    const onChange = vi.fn();

    watchMicPermission(onChange);
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Permission revoked at the OS level, without the browser firing onchange.
    status.state = 'denied';
    await vi.advanceTimersByTimeAsync(15000);
    expect(onChange).toHaveBeenLastCalledWith('denied');
  });
});
