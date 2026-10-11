import type { NativeUiMessage } from '../src/native_ui';
import { defaults } from '../src/settings';
import type { Settings } from '../src/settings';
import { commandsForMode } from '../src/commands';

// The overlay modules keep native-mode state at module level, so each test
// imports fresh copies after stubbing the host's message handler.
let posted: NativeUiMessage[];

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  posted = [];
  window.webkit = {
    messageHandlers: { kikoeUI: { postMessage: vi.fn((m: NativeUiMessage) => { posted.push(m); }) } },
  };
});

afterEach(() => {
  delete window.webkit;
});

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...defaults, ...overrides };
}

function tap(action: string): void {
  document.dispatchEvent(new CustomEvent('kikoe:nativeUi', { detail: { action } }));
}

describe('native_ui', () => {
  test('is off without the kikoeUI handler', async () => {
    delete window.webkit;
    const { isNativeUi, postNativeUi } = await import('../src/native_ui');
    expect(isNativeUi()).toBe(false);
    expect(() => postNativeUi({ type: 'clearTranscript' })).not.toThrow();
  });

  test('posts messages to the host', async () => {
    const { isNativeUi, postNativeUi } = await import('../src/native_ui');
    expect(isNativeUi()).toBe(true);
    postNativeUi({ type: 'clearTranscript' });
    expect(posted).toEqual([{ type: 'clearTranscript' }]);
  });

  test('routes host actions to the latest registered handler', async () => {
    const { onNativeUiAction } = await import('../src/native_ui');
    const first = vi.fn();
    const second = vi.fn();
    onNativeUiAction('helpButtonTapped', first);
    onNativeUiAction('helpButtonTapped', second);

    tap('helpButtonTapped');
    tap('somethingElse');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('live_transcript on the native host', () => {
  test('renders no DOM and posts the indicator state instead', async () => {
    const lt = await import('../src/live_transcript');
    lt.createTranscriptContainer(settings());
    lt.showIdleIndicator(settings(), vi.fn());
    lt.setIdleIndicatorState('mic-denied');
    lt.setIdleIndicatorState('muted');

    expect(document.getElementById('kikoe-transcript-container')).toBeNull();
    expect(document.getElementById('kikoe-idle')).toBeNull();
    expect(posted).toEqual([
      { type: 'indicator', state: 'listening', label: 'Listening', tone: 'normal' },
      { type: 'indicator', state: 'mic-denied', label: '⚠ Microphone access denied', tone: 'error' },
      { type: 'indicator', state: 'muted', label: 'Muted', tone: 'muted' },
    ]);
  });

  test('shows the indicator even with the transcript turned off', async () => {
    const lt = await import('../src/live_transcript');
    lt.showIdleIndicator(settings({ transcript: false }));
    expect(posted).toContainEqual(expect.objectContaining({ type: 'indicator', state: 'listening' }));
  });

  test('an indicator tap toggles the mic, or opens the token page with no token', async () => {
    const lt = await import('../src/live_transcript');
    const onToggle = vi.fn();
    const tokenPage = vi.fn();
    document.addEventListener('kikoe:openApiTokenPage', tokenPage);
    lt.showIdleIndicator(settings(), onToggle);

    tap('indicatorTapped');
    expect(onToggle).toHaveBeenCalledTimes(1);

    lt.setIdleIndicatorState('no-token');
    tap('indicatorTapped');
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(tokenPage).toHaveBeenCalledTimes(1);
    document.removeEventListener('kikoe:openApiTokenPage', tokenPage);
  });

  test('posts transcripts with their hint and a correction candidate', async () => {
    const lt = await import('../src/live_transcript');
    const s = settings({ transcript_position: 'bottom' });
    lt.logTranscript(s, { raw: 'さむい', matched: 'さむい' });
    lt.logTranscript(s, {
      raw: 'some way', reason: 'no-match', correction: { heard: 'some way', intended: 'さむい' },
    });
    lt.logTranscript(s, '!! mic error !!');

    expect(posted).toEqual([
      { type: 'transcript', text: 'さむい', detail: '→ さむい', error: false, position: 'bottom', correction: null },
      {
        type: 'transcript', text: 'some way', detail: '— no match', error: false, position: 'bottom',
        correction: { heard: 'some way', intended: 'さむい' },
      },
      { type: 'transcript', text: 'mic error', detail: null, error: true, position: 'bottom', correction: null },
    ]);
  });

  test('drops repeated raw interims but not a repeat that adds a result', async () => {
    const lt = await import('../src/live_transcript');
    lt.logTranscript(settings(), { raw: 'cold' });
    lt.logTranscript(settings(), { raw: 'cold' });
    lt.logTranscript(settings(), { raw: 'cold', reason: 'no-match' });
    expect(posted.map(m => m.type === 'transcript' && m.detail)).toEqual([null, '— no match']);
  });

  test('respects the transcript setting and clears through the host', async () => {
    const lt = await import('../src/live_transcript');
    lt.logTranscript(settings({ transcript: false }), { raw: 'cold' });
    lt.clearTranscript();
    expect(posted).toEqual([{ type: 'clearTranscript' }]);
  });
});

describe('help on the native host', () => {
  test('the ? button follows the setting and its tap runs the toggle', async () => {
    const help = await import('../src/help');
    const onActivate = vi.fn();
    help.updateHelpChip(settings(), onActivate);
    expect(document.getElementById('kikoe-help-chip')).toBeNull();
    expect(posted).toEqual([{ type: 'helpButton', visible: true }]);

    tap('helpButtonTapped');
    expect(onActivate).toHaveBeenCalledTimes(1);

    help.updateHelpChip(settings({ show_help_button: false }), onActivate);
    expect(posted).toContainEqual({ type: 'helpButton', visible: false });
  });

  test('opens the native panel and reports dismissal back through onClose', async () => {
    const help = await import('../src/help');
    const onClose = vi.fn();
    const commands = commandsForMode('standard');
    help.openHelpPanel(settings(), { commands, language: 'Japanese' }, onClose);

    expect(document.getElementById('kikoe-help-panel')).toBeNull();
    expect(help.isHelpPanelOpen()).toBe(true);
    const open = posted.find(m => m.type === 'help');
    expect(open).toMatchObject({ type: 'help', open: true, language: 'Japanese' });
    expect(open && 'commands' in open && open.commands).toHaveLength(commands.length);

    // The user swipes the sheet away.
    tap('helpDismissed');
    expect(help.isHelpPanelOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(posted).toContainEqual({ type: 'help', open: false });
  });

  test('closing from the page closes the native panel once', async () => {
    const help = await import('../src/help');
    help.openHelpPanel(settings(), { commands: [], language: 'English' });
    help.closeHelpPanel();
    help.closeHelpPanel();
    expect(posted.filter(m => m.type === 'help' && !m.open)).toHaveLength(1);
  });

  test('the discovery hint goes to the host', async () => {
    const help = await import('../src/help');
    help.showHelpHint(settings());
    expect(document.getElementById('kikoe-help-hint')).toBeNull();
    expect(posted).toEqual([expect.objectContaining({ type: 'helpHint' })]);
  });
});
