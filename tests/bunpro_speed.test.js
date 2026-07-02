import { startSpeedEnhancer } from '../src/bunpro_speed.js';

// vi.mock is hoisted to the top of the file, so we must define the mocks
// with vi.hoisted so they're initialized before the factory runs.
const { clickNext, clickInfo } = vi.hoisted(() => ({
  clickNext: vi.fn(),
  clickInfo: vi.fn(),
}));

vi.mock('../src/bunpro.js', () => ({ clickNext, clickInfo }));

// Each enhancer leaves live MutationObservers on document.body — stop them
// after each test so earlier instances can't react to later tests' DOM.
let enhancers = [];

function start(getSettingsFn) {
  const enhancer = startSpeedEnhancer(getSettingsFn);
  enhancers.push(enhancer);
  return enhancer;
}

beforeEach(() => {
  vi.useFakeTimers();
  clickNext.mockClear();
  clickInfo.mockClear();
  document.body.innerHTML = '';
});

afterEach(() => {
  for (const e of enhancers) e.stop();
  enhancers = [];
  vi.useRealTimers();
});

function addMetadata(attrs = {}) {
  const el = document.createElement('div');
  el.id = 'quiz-metadata-element';
  const defaults = {
    'data-meta-loc': 'review',
    'data-meta-is-correct': 'false',
    'data-meta-is-post-attempt': 'false',
    'data-meta-info': JSON.stringify({ id: 806, type: 'vocab' }),
    'data-meta-total-submissions-count': '0',
  };
  for (const [k, v] of Object.entries({ ...defaults, ...attrs })) {
    el.setAttribute(k, v);
  }
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

// Simulate BunPro evaluating an answer: is-correct is set alongside
// is-post-attempt flipping to true.
function answer(el, correct) {
  el.setAttribute('data-meta-is-correct', String(correct));
  el.setAttribute('data-meta-is-post-attempt', 'true');
}

describe('startSpeedEnhancer (bunpro)', () => {
  test('attaches to an existing metadata element on start', () => {
    const el = addMetadata();
    const { _getContainer } = start(() => makeSettings());
    expect(_getContainer()).toBe(el);
  });

  test('calls clickNext after the result delay on a correct answer', async () => {
    const el = addMetadata();
    start(() => makeSettings({ turbo: true }));
    answer(el, true);
    await Promise.resolve();
    expect(clickNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(clickNext).toHaveBeenCalledTimes(1);
  });

  test('does not call clickNext when turbo is off', async () => {
    const el = addMetadata();
    start(() => makeSettings({ turbo: false }));
    answer(el, true);
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickNext).not.toHaveBeenCalled();
  });

  test('skips clickNext when BunPro native lightning already advanced the card', async () => {
    const el = addMetadata();
    start(() => makeSettings({ turbo: true }));
    answer(el, true);
    await Promise.resolve();
    // Native Lightning Mode swaps to the next card before our timer fires.
    el.setAttribute('data-meta-info', JSON.stringify({ id: 807, type: 'vocab' }));
    vi.advanceTimersByTime(100);
    expect(clickNext).not.toHaveBeenCalled();
  });

  test('calls clickInfo after the result delay on a wrong answer', async () => {
    const el = addMetadata();
    start(() => makeSettings({ speed_show_info: true }));
    answer(el, false);
    await Promise.resolve();
    expect(clickInfo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(clickInfo).toHaveBeenCalledTimes(1);
  });

  test('does not call clickInfo when speed_show_info is off', async () => {
    const el = addMetadata();
    start(() => makeSettings({ speed_show_info: false }));
    answer(el, false);
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickInfo).not.toHaveBeenCalled();
  });

  test('ignores pre-answer mutations while is-post-attempt is false', async () => {
    const el = addMetadata();
    start(() => makeSettings({ turbo: true, speed_show_info: true }));
    // BunPro renders is-correct="false" before any answer is given.
    el.setAttribute('data-meta-is-correct', 'false');
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickNext).not.toHaveBeenCalled();
    expect(clickInfo).not.toHaveBeenCalled();
  });

  test('handles a result only once even though both attributes mutate', async () => {
    const el = addMetadata();
    start(() => makeSettings({ turbo: true }));
    answer(el, true);
    await Promise.resolve();
    // A later unrelated mutation of a watched attribute must not re-fire.
    el.setAttribute('data-meta-is-post-attempt', 'true');
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickNext).toHaveBeenCalledTimes(1);
  });

  test('reacts to a repeat attempt on the same card (submission count changed)', async () => {
    const el = addMetadata();
    start(() => makeSettings({ speed_show_info: true }));
    answer(el, false);
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickInfo).toHaveBeenCalledTimes(1);

    // Same card asked again: post-attempt resets, then a second wrong answer.
    el.setAttribute('data-meta-is-post-attempt', 'false');
    el.setAttribute('data-meta-total-submissions-count', '1');
    await Promise.resolve();
    answer(el, false);
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickInfo).toHaveBeenCalledTimes(2);
  });

  test('picks up a metadata element added after init', async () => {
    const { _getContainer } = start(() => makeSettings());
    expect(_getContainer()).toBeNull();
    addMetadata();
    await Promise.resolve();
    expect(_getContainer()).not.toBeNull();
  });
});
