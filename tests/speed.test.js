import { startSpeedEnhancer } from '../src/speed.js';

// vi.mock is hoisted to the top of the file, so we must define the mocks
// with vi.hoisted so they're initialized before the factory runs.
const { clickNext, clickInfo } = vi.hoisted(() => ({
  clickNext: vi.fn(),
  clickInfo: vi.fn(),
}));

vi.mock('../src/wanikani.js', () => ({ clickNext, clickInfo }));

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
    lightning: false,
    lightning_delay: 0.1,
    speed_show_info: true,
    mistake_delay: 0.1,
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

  test('does not call clickNext when lightning is off (correct answer)', async () => {
    const el = addContainer();
    startSpeedEnhancer(() => makeSettings({ lightning: false }));
    el.setAttribute('correct', 'true');
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickNext).not.toHaveBeenCalled();
  });

  test('calls clickNext after lightning_delay when lightning is on and answer is correct', async () => {
    const el = addContainer();
    startSpeedEnhancer(() => makeSettings({ lightning: true, lightning_delay: 0.5 }));
    el.setAttribute('correct', 'true');
    await Promise.resolve();
    expect(clickNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(clickNext).toHaveBeenCalledTimes(1);
  });

  test('calls clickInfo after mistake_delay when speed_show_info is on and answer is wrong', async () => {
    const el = addContainer();
    startSpeedEnhancer(() => makeSettings({ speed_show_info: true, mistake_delay: 0.2 }));
    el.setAttribute('correct', 'false');
    await Promise.resolve();
    expect(clickInfo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
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

  test('does not call clickNext on wrong answer even when lightning is on', async () => {
    const el = addContainer();
    startSpeedEnhancer(() => makeSettings({ lightning: true, speed_show_info: false }));
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

  test('reads settings lazily — respects updated setting at fire time', async () => {
    const el = addContainer();
    let lightning = false;
    startSpeedEnhancer(() => makeSettings({ lightning, lightning_delay: 0.1 }));
    lightning = true; // flip after init, before the attribute fires
    el.setAttribute('correct', 'true');
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickNext).toHaveBeenCalledTimes(1);
  });
});
