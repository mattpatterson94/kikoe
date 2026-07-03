import {
  updateHelpChip,
  openHelpPanel,
  closeHelpPanel,
  isHelpPanelOpen,
  showHelpHint,
} from '../src/help';
import { commandsForMode } from '../src/commands';

const defaultSettings = {
  transcript: true,
  transcript_theme: 'system',
  transcript_position: 'top',
  show_help_button: true,
};

function settings(overrides = {}) {
  return { ...defaultSettings, ...overrides };
}

function view(overrides = {}) {
  return { commands: commandsForMode('standard'), language: 'English', ...overrides };
}

beforeEach(() => {
  closeHelpPanel();
  document.body.innerHTML = '';
});

// ── updateHelpChip ────────────────────────────────────────────────────────────

describe('updateHelpChip', () => {
  test('creates the ? chip when show_help_button is on', () => {
    updateHelpChip(settings(), vi.fn());
    const chip = document.getElementById('kikoe-help-chip');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('?');
    expect(chip.getAttribute('role')).toBe('button');
  });

  test('is idempotent — a second call does not add a second chip', () => {
    updateHelpChip(settings(), vi.fn());
    updateHelpChip(settings(), vi.fn());
    expect(document.querySelectorAll('#kikoe-help-chip').length).toBe(1);
  });

  test('removes the chip when show_help_button is turned off', () => {
    updateHelpChip(settings(), vi.fn());
    updateHelpChip(settings({ show_help_button: false }), vi.fn());
    expect(document.getElementById('kikoe-help-chip')).toBeNull();
  });

  test('turning the chip off also closes an open panel', () => {
    updateHelpChip(settings(), vi.fn());
    openHelpPanel(settings(), view());
    updateHelpChip(settings({ show_help_button: false }), vi.fn());
    expect(isHelpPanelOpen()).toBe(false);
  });

  test('sits before the idle indicator inside the shared corner container', () => {
    // Simulate the indicator already occupying the corner.
    const corner = document.createElement('div');
    corner.id = 'kikoe-corner';
    document.body.appendChild(corner);
    const idle = document.createElement('div');
    idle.id = 'kikoe-idle';
    corner.appendChild(idle);

    updateHelpChip(settings(), vi.fn());
    expect(corner.firstElementChild.id).toBe('kikoe-help-chip');
  });

  test('clicking the chip invokes the activate callback', () => {
    const onActivate = vi.fn();
    updateHelpChip(settings(), onActivate);
    document.getElementById('kikoe-help-chip').click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test('pressing Enter on the chip invokes the activate callback', () => {
    const onActivate = vi.fn();
    updateHelpChip(settings(), onActivate);
    document.getElementById('kikoe-help-chip').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

// ── openHelpPanel / closeHelpPanel ────────────────────────────────────────────

describe('openHelpPanel', () => {
  test('renders a dialog listing the given commands with descriptions', () => {
    openHelpPanel(settings(), view());
    const panel = document.getElementById('kikoe-help-panel');
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.textContent).toContain('"next" · 次');
    expect(panel.textContent).toContain('Advance to the next card');
    expect(panel.textContent).toContain('"help"');
  });

  test('shows only the commands for the given context (reveal-hidden has no grade commands)', () => {
    openHelpPanel(settings(), view({ commands: commandsForMode('reveal-hidden') }));
    const panel = document.getElementById('kikoe-help-panel');
    expect(panel.textContent).toContain('Show the answer');
    expect(panel.textContent).not.toContain('Grade as known');
  });

  test('shows the current listening language', () => {
    openHelpPanel(settings(), view({ language: 'Japanese' }));
    expect(document.getElementById('kikoe-help-panel').textContent).toContain('listening in Japanese');
  });

  test('includes the tips and a link to the full guide', () => {
    openHelpPanel(settings(), view());
    const panel = document.getElementById('kikoe-help-panel');
    expect(panel.textContent).toContain('mute');
    expect(panel.textContent).toContain('Custom Corrections');
    const link = panel.querySelector('a.kikoe-help-link');
    expect(link.href).toContain('github.com/mattpatterson94/kikoe');
  });

  test('does not open a second panel while one is already open', () => {
    openHelpPanel(settings(), view());
    openHelpPanel(settings(), view());
    expect(document.querySelectorAll('#kikoe-help-panel').length).toBe(1);
  });
});

describe('closing the panel', () => {
  test('the ✕ button closes the panel and fires onClose', () => {
    const onClose = vi.fn();
    openHelpPanel(settings(), view(), onClose);
    document.querySelector('.kikoe-help-close').click();
    expect(isHelpPanelOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Escape closes the panel and fires onClose', () => {
    const onClose = vi.fn();
    openHelpPanel(settings(), view(), onClose);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isHelpPanelOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking outside the panel closes it', () => {
    const onClose = vi.fn();
    openHelpPanel(settings(), view(), onClose);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isHelpPanelOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking inside the panel keeps it open', () => {
    openHelpPanel(settings(), view());
    document.querySelector('.kikoe-help-title')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isHelpPanelOpen()).toBe(true);
  });

  test('clicking the help chip does not close the panel via click-away (the chip toggle owns that)', () => {
    updateHelpChip(settings(), vi.fn());
    openHelpPanel(settings(), view());
    document.getElementById('kikoe-help-chip')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isHelpPanelOpen()).toBe(true);
  });

  test('closeHelpPanel is a no-op when nothing is open', () => {
    expect(() => closeHelpPanel()).not.toThrow();
  });
});

// ── showHelpHint ──────────────────────────────────────────────────────────────

describe('showHelpHint', () => {
  test('shows the one-time discovery bubble', () => {
    showHelpHint(settings());
    const hint = document.getElementById('kikoe-help-hint');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('say "help"');
  });

  test('a second call does not add a second bubble', () => {
    showHelpHint(settings());
    showHelpHint(settings());
    expect(document.querySelectorAll('#kikoe-help-hint').length).toBe(1);
  });
});
