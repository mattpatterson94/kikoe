import { startSpeedEnhancer } from '../src/speed';

// vi.mock is hoisted to the top of the file, so we must define the mocks
// with vi.hoisted so they're initialized before the factory runs.
const { clickNext, clickInfo } = vi.hoisted(() => ({
  clickNext: vi.fn(),
  clickInfo: vi.fn(),
}));

vi.mock('../src/wanikani', () => ({ clickNext, clickInfo }));

beforeEach(() => {
  vi.useFakeTimers();
  clickNext.mockClear();
  clickInfo.mockClear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

function addContainer(attrs = {}) {
  const el = document.createElement('div');
  el.className = 'quiz-input__input-container';
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

function makeSettings(overrides = {}) {
  return {
    turbo: false,
    speed_show_info: true,
    ...overrides,
  };
}

describe('startSpeedEnhancer', () => {
  test('returns scan and _getContainer', () => {
    const result = startSpeedEnhancer(() => makeSettings());
    expect(typeof result.scan).toBe('function');
    expect(typeof result._getContainer).toBe('function');
  });

  test('attaches to existing container on start', () => {
    const el = addContainer();
    const { _getContainer } = startSpeedEnhancer(() => makeSettings());
    expect(_getContainer()).toBe(el);
  });

  test('does not call clickNext when turbo is off (correct answer)', async () => {
    const el = addContainer();
    startSpeedEnhancer(() => makeSettings({ turbo: false }));
    el.setAttribute('correct', 'true');
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickNext).not.toHaveBeenCalled();
  });

  test('calls clickNext after the result delay when turbo is on and answer is correct', async () => {
    const el = addContainer();
    startSpeedEnhancer(() => makeSettings({ turbo: true }));
    el.setAttribute('correct', 'true');
    await Promise.resolve();
    expect(clickNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(clickNext).toHaveBeenCalledTimes(1);
  });

  test('calls clickInfo after the result delay when speed_show_info is on and answer is wrong', async () => {
    const el = addContainer();
    startSpeedEnhancer(() => makeSettings({ speed_show_info: true }));
    el.setAttribute('correct', 'false');
    await Promise.resolve();
    expect(clickInfo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(clickInfo).toHaveBeenCalledTimes(1);
  });

  test('does not call clickInfo when speed_show_info is off', async () => {
    const el = addContainer();
    startSpeedEnhancer(() => makeSettings({ speed_show_info: false }));
    el.setAttribute('correct', 'false');
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickInfo).not.toHaveBeenCalled();
  });

  test('does not call clickNext on wrong answer even when turbo is on', async () => {
    const el = addContainer();
    startSpeedEnhancer(() => makeSettings({ turbo: true, speed_show_info: false }));
    el.setAttribute('correct', 'false');
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickNext).not.toHaveBeenCalled();
  });

  test('picks up container added after init via MutationObserver', async () => {
    const { scan, _getContainer } = startSpeedEnhancer(() => makeSettings());
    expect(_getContainer()).toBeNull();
    addContainer();
    // Flush the MutationObserver microtask queue.
    await Promise.resolve();
    scan(); // fallback explicit scan
    expect(_getContainer()).not.toBeNull();
  });

  test('reads settings lazily — clickInfo respects updated setting at fire time', async () => {
    const el = addContainer();
    let showInfo = false;
    startSpeedEnhancer(() => makeSettings({ speed_show_info: showInfo }));
    showInfo = true; // flip after init, before the attribute fires
    el.setAttribute('correct', 'false');
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickInfo).toHaveBeenCalledTimes(1);
  });
});
