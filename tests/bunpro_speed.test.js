import { startSpeedEnhancer } from '../src/bunpro_speed';

// vi.mock is hoisted to the top of the file, so we must define the mocks
// with vi.hoisted so they're initialized before the factory runs.
const { clickNext, clickInfo, takeSelfSubmittedWrongCardId } = vi.hoisted(() => ({
  clickNext: vi.fn(),
  clickInfo: vi.fn(),
  takeSelfSubmittedWrongCardId: vi.fn(() => null),
}));

vi.mock('../src/bunpro', () => ({ clickNext, clickInfo, takeSelfSubmittedWrongCardId }));

// Stand in for markWrong() having just submitted a placeholder answer for the
// given card: the real flag is read once and cleared (see bunpro.ts).
function selfSubmittedWrongFor(cardId) {
  takeSelfSubmittedWrongCardId.mockImplementationOnce(() => cardId);
}

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
  takeSelfSubmittedWrongCardId.mockReset();
  takeSelfSubmittedWrongCardId.mockImplementation(() => null);
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

  test('calls clickInfo after the result delay on a wrong answer Kikoe submitted', async () => {
    const el = addMetadata();
    start(() => makeSettings({ speed_show_info: true }));
    selfSubmittedWrongFor(806);
    answer(el, false);
    await Promise.resolve();
    expect(clickInfo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(clickInfo).toHaveBeenCalledTimes(1);
  });

  // The card is already showing BunPro's own reveal in this case; clicking
  // into it would re-render over the top of that.
  test('does not call clickInfo for a wrong answer Kikoe did not submit', async () => {
    const el = addMetadata();
    start(() => makeSettings({ speed_show_info: true }));
    answer(el, false);
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickInfo).not.toHaveBeenCalled();
  });

  test('does not call clickInfo when speed_show_info is off', async () => {
    const el = addMetadata();
    start(() => makeSettings({ speed_show_info: false }));
    selfSubmittedWrongFor(806);
    answer(el, false);
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickInfo).not.toHaveBeenCalled();
  });

  test('does not open info when the flag belongs to an earlier card', async () => {
    const el = addMetadata({ 'data-meta-info': JSON.stringify({ id: 807, type: 'vocab' }) });
    start(() => makeSettings({ speed_show_info: true }));
    // markWrong() raised the flag on 806, but 807 is what got graded.
    selfSubmittedWrongFor(806);
    answer(el, false);
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickInfo).not.toHaveBeenCalled();
  });

  test('does not reuse one flag for a later wrong answer', async () => {
    const el = addMetadata();
    start(() => makeSettings({ speed_show_info: true }));
    selfSubmittedWrongFor(806);
    answer(el, false);
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    expect(clickInfo).toHaveBeenCalledTimes(1);

    // Same card asked again, this time answered wrong by the user directly.
    el.setAttribute('data-meta-is-post-attempt', 'false');
    el.setAttribute('data-meta-total-submissions-count', '1');
    await Promise.resolve();
    answer(el, false);
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickInfo).toHaveBeenCalledTimes(1);
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
    selfSubmittedWrongFor(806);
    answer(el, false);
    await Promise.resolve();
    vi.runAllTimers();
    expect(clickInfo).toHaveBeenCalledTimes(1);

    // Same card asked again: post-attempt resets, then a second wrong answer.
    el.setAttribute('data-meta-is-post-attempt', 'false');
    el.setAttribute('data-meta-total-submissions-count', '1');
    await Promise.resolve();
    selfSubmittedWrongFor(806);
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
