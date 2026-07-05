import type { Settings } from './settings';
import type { CommandSpec } from './commands';
import { themeClass, ensureCornerContainer } from './live_transcript';

const STYLE_ID = 'kikoe-help-styles';
const HINT_FADE_DELAY_MS = 8000;
const README_URL = 'https://github.com/mattpatterson94/kikoe#using-the-extension';

// What the panel renders — app.ts assembles this from the current card's
// context so only commands that work right now are listed.
export interface HelpView {
  commands: CommandSpec[];
  language: 'Japanese' | 'English';
}

const TIPS = [
  'Click the Listening chip (or say "pause") to mute the mic; click it again to resume.',
  'Kikoe listens for Japanese on reading questions and English on meaning questions, switching automatically.',
  'If a word keeps getting misheard, add a fix under Custom Corrections in the extension settings.',
];

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .kikoe-help-chip {
      justify-content: center;
      padding: 6px 11px;
      font-weight: 700;
    }

    .kikoe-help-panel {
      position: fixed;
      bottom: 56px;
      right: 16px;
      z-index: 2147483647;
      width: min(380px, calc(100vw - 32px));
      max-height: min(70vh, 560px);
      overflow-y: auto;
      border-radius: 18px;
      padding: 14px 18px 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
      font-weight: 400;
      line-height: 1.5;
      animation: kikoe-in 0.22s cubic-bezier(0.34, 1.4, 0.64, 1) both;
    }

    .kikoe-help-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 2px;
    }
    .kikoe-help-title {
      font-size: 14px;
      font-weight: 700;
    }
    .kikoe-help-close {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 4px;
      opacity: 0.7;
    }
    .kikoe-help-close:hover { opacity: 1; }

    .kikoe-help-lang {
      opacity: 0.65;
      margin-bottom: 10px;
    }

    .kikoe-help-row {
      display: flex;
      gap: 12px;
      margin: 7px 0;
    }
    .kikoe-help-say {
      font-weight: 600;
      flex: 1 1 55%;
    }
    .kikoe-help-desc {
      opacity: 0.75;
      flex: 1 1 45%;
    }

    .kikoe-help-tips {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid rgba(128, 128, 128, 0.3);
    }
    .kikoe-help-tip {
      opacity: 0.75;
      margin: 5px 0;
    }

    .kikoe-help-link {
      display: inline-block;
      margin-top: 10px;
      color: inherit;
      font-weight: 600;
    }

    .kikoe-help-hint {
      position: fixed;
      bottom: 56px;
      right: 16px;
      z-index: 2147483647;
      font-size: 13px;
      font-weight: 500;
      transition: opacity 0.4s ease;
    }
  `;
  document.head.appendChild(style);
}

// Show or remove the "?" chip to match the show_help_button setting. Called
// once at startup and again on every settings change, so toggling the option
// takes effect without a reload. Saying "help" works regardless of the chip.
export function updateHelpChip(settings: Settings, onActivate: () => void): void {
  const existing = document.getElementById('kikoe-help-chip');
  if (!settings.show_help_button) {
    existing?.remove();
    closeHelpPanel();
    return;
  }
  if (existing) return;

  injectStyles();
  const chip = document.createElement('div');
  chip.id = 'kikoe-help-chip';
  chip.className = `kikoe-chip ${themeClass(settings)} kikoe-idle kikoe-idle-clickable kikoe-help-chip`;
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.setAttribute('title', 'Voice commands & tips');
  chip.setAttribute('aria-label', 'Show voice command help');
  chip.textContent = '?';
  chip.addEventListener('click', onActivate);
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  });
  // Prepend so the chip sits left of the status indicator.
  ensureCornerContainer().prepend(chip);
}

export function updateRecognitionModeChip(settings: Settings, onToggle: () => void): void {
  let chip = document.getElementById('kikoe-recognition-mode-chip');
  if (!chip) {
    injectStyles();
    chip = document.createElement('div');
    chip.id = 'kikoe-recognition-mode-chip';
    chip.className = `kikoe-chip ${themeClass(settings)} kikoe-idle kikoe-idle-clickable kikoe-help-chip`;
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('aria-label', 'Toggle reading recognition mode');
    chip.addEventListener('click', onToggle);
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    });
    const help = document.getElementById('kikoe-help-chip');
    if (help?.parentElement) help.insertAdjacentElement('afterend', chip);
    else ensureCornerContainer().prepend(chip);
  }

  chip.className = `kikoe-chip ${themeClass(settings)} kikoe-idle kikoe-idle-clickable kikoe-help-chip`;
  const romaji = settings.reading_recognition_mode === 'romaji';
  chip.textContent = romaji ? 'R' : 'あ';
  chip.setAttribute('title', romaji
    ? 'Reading recognition: Romaji. Click for Japanese.'
    : 'Reading recognition: Japanese. Click for Romaji.');
}

export function isHelpPanelOpen(): boolean {
  return !!document.getElementById('kikoe-help-panel');
}

let onCloseCallback: (() => void) | null = null;

function onDocumentKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.getElementById('kikoe-help-panel')) e.stopPropagation();
  closeHelpPanel();
}

// Click-away dismissal. Clicks inside the panel do nothing; clicks on the
// help chip are left to the chip's own toggle handler (which sees the panel
// still open and closes it) so they don't close-then-reopen. A missing
// panel (host-page re-render wiped it) still goes through closeHelpPanel so
// the pending onClose fires and the mic isn't stranded paused.
function onDocumentClick(e: MouseEvent): void {
  const target = e.target as Node;
  const panel = document.getElementById('kikoe-help-panel');
  if (panel && panel.contains(target)) return;
  if (document.getElementById('kikoe-help-chip')?.contains(target)) return;
  if (document.getElementById('kikoe-recognition-mode-chip')?.contains(target)) return;
  closeHelpPanel();
}

// "next" · 次 — every English phrase plus the primary Japanese one; the rest
// of the Japanese variants are recognizer-spelling duplicates.
function displayPhrases(spec: CommandSpec): string {
  const en = spec.en.map((p) => `"${p}"`);
  return [...en, ...spec.ja.slice(0, 1)].join(' · ');
}

export function openHelpPanel(settings: Settings, view: HelpView, onClose?: () => void): void {
  if (isHelpPanelOpen()) return;
  injectStyles();
  onCloseCallback = onClose ?? null;

  const panel = document.createElement('div');
  panel.id = 'kikoe-help-panel';
  panel.className = `kikoe-help-panel ${themeClass(settings)}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Kikoe voice commands');

  const header = document.createElement('div');
  header.className = 'kikoe-help-header';
  const title = document.createElement('span');
  title.className = 'kikoe-help-title';
  title.textContent = 'Kikoe voice commands';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'kikoe-help-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close help');
  close.addEventListener('click', () => closeHelpPanel());
  header.append(title, close);
  panel.appendChild(header);

  const lang = document.createElement('div');
  lang.className = 'kikoe-help-lang';
  lang.textContent = `Mic is paused while this is open · listening in ${view.language}`;
  panel.appendChild(lang);

  for (const spec of view.commands) {
    const row = document.createElement('div');
    row.className = 'kikoe-help-row';
    const say = document.createElement('span');
    say.className = 'kikoe-help-say';
    say.textContent = displayPhrases(spec);
    const desc = document.createElement('span');
    desc.className = 'kikoe-help-desc';
    desc.textContent = spec.description;
    row.append(say, desc);
    panel.appendChild(row);
  }

  const tips = document.createElement('div');
  tips.className = 'kikoe-help-tips';
  for (const text of TIPS) {
    const tip = document.createElement('div');
    tip.className = 'kikoe-help-tip';
    tip.textContent = text;
    tips.appendChild(tip);
  }
  panel.appendChild(tips);

  const link = document.createElement('a');
  link.className = 'kikoe-help-link';
  link.href = README_URL;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = 'Full guide ↗';
  panel.appendChild(link);

  document.body.appendChild(panel);
  document.addEventListener('keydown', onDocumentKeydown, true);
  document.addEventListener('click', onDocumentClick, true);
}

// Idempotent: always detaches the document listeners and fires any pending
// onClose, even if the panel element was already removed by a host-page
// re-render — otherwise recognition would stay paused with no panel showing.
export function closeHelpPanel(): void {
  document.removeEventListener('keydown', onDocumentKeydown, true);
  document.removeEventListener('click', onDocumentClick, true);
  document.getElementById('kikoe-help-panel')?.remove();
  const cb = onCloseCallback;
  onCloseCallback = null;
  cb?.();
}

// One-time discovery nudge shown on the first session after the feature
// lands (gated by the help_hint_shown flag — see app.ts / content.ts).
export function showHelpHint(settings: Settings): void {
  if (document.getElementById('kikoe-help-hint')) return;
  injectStyles();
  const el = document.createElement('div');
  el.id = 'kikoe-help-hint';
  el.className = `kikoe-chip ${themeClass(settings)} kikoe-help-hint`;
  el.textContent = 'New: say "help" or click ? for voice commands';
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
  }, HINT_FADE_DELAY_MS);
}
