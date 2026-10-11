import type { Settings } from './settings';
import { isNativeUi, onNativeUiAction, postNativeUi } from './native_ui';

const STYLE_ID = 'kikoe-transcript-styles';
const TRANSCRIPT_FADE_DELAY_MS = 5000;
const TRANSCRIPT_MAX_VISIBLE = 1;

// What logTranscript renders. Structurally compatible with flashcards'
// Transcript, but `reason` is wider: app.js also logs reveal-mode hints
// ('say-reveal' / 'say-grade') that never come out of checkAnswer.
export interface TranscriptInfo {
  raw: string;
  matched?: string;
  reason?: string;
  type?: string;
  correction?: {
    heard: string;
    intended: string;
  };
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes kikoe-in {
      from { opacity: 0; transform: translateY(10px) scale(0.94); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }
    @keyframes kikoe-pulse {
      0%, 100% { opacity: 0.35; transform: scale(1); }
      50%       { opacity: 0.85; transform: scale(1.25); }
    }

    .kikoe-chip {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px 10px 14px;
      border-radius: 999px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: clamp(14px, 2.6vh, 24px);
      font-weight: 600;
      letter-spacing: 0.015em;
      line-height: 1.15;
      animation: kikoe-in 0.22s cubic-bezier(0.34, 1.4, 0.64, 1) both;
      transition: opacity 0.38s ease, transform 0.38s ease;
      pointer-events: auto;
      user-select: none;
      max-width: 90vw;
    }

    .kikoe-theme-dark {
      background: rgba(18, 18, 26, 0.52);
      backdrop-filter: blur(28px) saturate(1.8);
      -webkit-backdrop-filter: blur(28px) saturate(1.8);
      border: 0.5px solid rgba(255, 255, 255, 0.14);
      box-shadow:
        inset 0 0.5px 0 rgba(255, 255, 255, 0.18),
        0 8px 32px rgba(0, 0, 0, 0.45),
        0 2px 8px rgba(0, 0, 0, 0.25);
      color: rgba(255, 255, 255, 0.92);
    }

    .kikoe-theme-light {
      background: rgba(255, 255, 255, 0.65);
      backdrop-filter: blur(28px) saturate(1.8);
      -webkit-backdrop-filter: blur(28px) saturate(1.8);
      border: 0.5px solid rgba(255, 255, 255, 0.85);
      box-shadow:
        inset 0 0.5px 0 rgba(255, 255, 255, 0.95),
        0 8px 32px rgba(0, 0, 0, 0.10),
        0 2px 6px rgba(0, 0, 0, 0.06);
      color: rgba(0, 0, 0, 0.82);
    }

    @media (prefers-color-scheme: dark) {
      .kikoe-theme-system {
        background: rgba(18, 18, 26, 0.52);
        backdrop-filter: blur(28px) saturate(1.8);
        -webkit-backdrop-filter: blur(28px) saturate(1.8);
        border: 0.5px solid rgba(255, 255, 255, 0.14);
        box-shadow:
          inset 0 0.5px 0 rgba(255, 255, 255, 0.18),
          0 8px 32px rgba(0, 0, 0, 0.45),
          0 2px 8px rgba(0, 0, 0, 0.25);
        color: rgba(255, 255, 255, 0.92);
      }
    }
    @media (prefers-color-scheme: light) {
      .kikoe-theme-system {
        background: rgba(255, 255, 255, 0.65);
        backdrop-filter: blur(28px) saturate(1.8);
        -webkit-backdrop-filter: blur(28px) saturate(1.8);
        border: 0.5px solid rgba(255, 255, 255, 0.85);
        box-shadow:
          inset 0 0.5px 0 rgba(255, 255, 255, 0.95),
          0 8px 32px rgba(0, 0, 0, 0.10),
          0 2px 6px rgba(0, 0, 0, 0.06);
        color: rgba(0, 0, 0, 0.82);
      }
    }

    /* Error chips override theme colours — double-class for specificity */
    .kikoe-chip.kikoe-chip-error {
      background: rgba(195, 42, 36, 0.62);
      border: 0.5px solid rgba(255, 120, 110, 0.2);
      box-shadow:
        inset 0 0.5px 0 rgba(255, 180, 170, 0.22),
        0 8px 32px rgba(160, 20, 20, 0.35),
        0 2px 8px rgba(0, 0, 0, 0.22);
      color: rgba(255, 255, 255, 0.95);
    }

    .kikoe-chip-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      flex-shrink: 0;
      animation: kikoe-pulse 1.4s ease-in-out infinite;
    }
    .kikoe-chip.kikoe-chip-error .kikoe-chip-dot {
      animation: none;
      opacity: 0.7;
    }

    .kikoe-chip-matched {
      opacity: 0.5;
      font-weight: 400;
      font-size: 0.82em;
    }

    .kikoe-idle {
      animation: none;
      font-size: clamp(10px, 1.6vh, 14px);
      padding: 6px 12px 6px 9px;
      font-weight: 500;
    }
    .kikoe-idle-clickable {
      cursor: pointer;
    }
    .kikoe-chip-clickable {
      cursor: pointer;
    }
    .kikoe-chip-clickable:hover,
    .kikoe-chip-clickable:focus-visible {
      transform: translateY(-1px) scale(1.02);
    }
    .kikoe-idle .kikoe-chip-dot {
      width: 6px;
      height: 6px;
    }

    /* Muted chip overrides theme colours, same pattern as the error chip. */
    .kikoe-chip.kikoe-chip-muted {
      background: rgba(120, 120, 130, 0.45);
      border: 0.5px solid rgba(255, 255, 255, 0.12);
      color: rgba(255, 255, 255, 0.75);
    }
    .kikoe-chip.kikoe-chip-muted .kikoe-chip-dot {
      animation: none;
      opacity: 0.4;
    }
  `;
  document.head.appendChild(style);
}

function getContainerStyle(settings: Settings): string {
  const position = settings.transcript_position;
  const posStyle = position === 'bottom' ? 'bottom: 16px;' : 'top: 16px;';
  return `width: 100%; position: fixed; z-index: 2147483647; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; left: 0; ${posStyle}`;
}

export function themeClass(settings: Settings): string {
  const t = settings.transcript_theme;
  if (t === 'dark' || t === 'light') return `kikoe-theme-${t}`;
  return 'kikoe-theme-system';
}

// The bottom-right corner holds every persistent control (status indicator,
// help chip) in one flex row, so siblings line up without measuring each
// other's width. Recreated on demand since WaniKani re-renders can wipe body
// content (see the missing-container regression tests).
export function ensureCornerContainer(): HTMLElement {
  let corner = document.getElementById('kikoe-corner');
  if (!corner) {
    corner = document.createElement('div');
    corner.id = 'kikoe-corner';
    corner.style.cssText = 'position: fixed; bottom: 16px; right: 16px; z-index: 2147483647; display: flex; align-items: center; gap: 8px;';
    document.body.appendChild(corner);
  }
  return corner;
}

export function createTranscriptContainer(settings: Settings): void {
  // The native host draws the transcript itself (see native_ui.ts).
  if (isNativeUi()) return;
  injectStyles();
  const container = document.createElement('div');
  container.id = 'kikoe-transcript-container';
  container.style.cssText = getContainerStyle(settings);
  document.body.appendChild(container);
}

let COUNTER = 1;

export function clearTranscript(): void {
  if (isNativeUi()) {
    nativeLastRaw = null;
    postNativeUi({ type: 'clearTranscript' });
    return;
  }
  const container = document.querySelector('div#kikoe-transcript-container');
  if (!container) return;
  container.textContent = '';
}

function clearTranscriptWith(id: string): void {
  const t = document.getElementById(id);
  if (t && t.parentNode) t.parentNode.removeChild(t);
}

function scheduleRemoval(el: HTMLElement): void {
  el.style.opacity = '0';
  el.style.transform = 'translateY(-6px) scale(0.95)';
  const remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
  el.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 450);
}

// onToggle, if provided, is called (with no arguments) whenever the user
// clicks the indicator — used to let the mic be muted/unmuted by click
// instead of only by voice command or tab visibility.
export function showIdleIndicator(settings: Settings, onToggle?: () => void): void {
  if (isNativeUi()) {
    showNativeIndicator(onToggle);
    return;
  }
  if (!settings.transcript) return;
  if (document.getElementById('kikoe-idle')) return;

  const el = document.createElement('div');
  el.id = 'kikoe-idle';
  el.className = `kikoe-chip ${themeClass(settings)} kikoe-idle`;
  if (onToggle) {
    el.classList.add('kikoe-idle-clickable');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', 'Toggle voice input');
    // In the no-token state the missing token is the problem, not the mic —
    // route the click to WaniKani's token page instead of the mute toggle.
    // The content script forwards the event to the background script, the only
    // context that can open a new tab.
    const onActivate = () => {
      if (el.dataset.state === 'no-token') {
        document.dispatchEvent(new CustomEvent('kikoe:openApiTokenPage'));
      } else {
        onToggle();
      }
    };
    el.addEventListener('click', onActivate);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    });
  }

  const dot = document.createElement('span');
  dot.className = 'kikoe-chip-dot';
  dot.setAttribute('aria-hidden', 'true');
  el.appendChild(dot);

  const label = document.createElement('span');
  label.id = 'kikoe-idle-label';
  label.textContent = 'Listening';
  el.appendChild(label);

  ensureCornerContainer().appendChild(el);
}

const ERROR_STYLED_STATES = new Set(['error', 'mic-denied', 'no-mic', 'unsupported-browser', 'cannot-read-page']);

function indicatorLabel(state: string): string {
  if (state === 'loading') return 'Loading…';
  if (state === 'retrying') return 'Retrying…';
  if (state === 'restarting') return 'Restarting…';
  if (state === 'reconnecting') return 'Reconnecting…';
  if (state === 'paused') return 'Paused';
  if (state === 'muted') return 'Muted';
  if (state === 'no-token') return '⚠ No API token';
  if (state === 'unsupported') return '⚠ Unsupported card type';
  if (state === 'unsupported-browser') return '⚠ Voice recognition not supported by this browser';
  if (state === 'mic-denied') return '⚠ Microphone access denied';
  if (state === 'no-mic') return '⚠ No microphone found';
  if (state === 'error') return '⚠ Subjects failed to load';
  if (state === 'cannot-read-page') return "⚠ Can't read this page";
  return 'Listening';
}

// The native indicator is part of the app's chrome, so unlike the DOM chip
// it shows whether or not the transcript setting is on.
let nativeIndicatorState = 'listening';

function postNativeIndicator(state: string): void {
  nativeIndicatorState = state;
  postNativeUi({
    type: 'indicator',
    state,
    label: indicatorLabel(state),
    tone: ERROR_STYLED_STATES.has(state) ? 'error' : state === 'muted' ? 'muted' : 'normal',
  });
}

function showNativeIndicator(onToggle?: () => void): void {
  if (onToggle) {
    // Same routing as the DOM chip's click: with no token, the token is the
    // problem, not the mic.
    onNativeUiAction('indicatorTapped', () => {
      if (nativeIndicatorState === 'no-token') {
        document.dispatchEvent(new CustomEvent('kikoe:openApiTokenPage'));
      } else {
        onToggle();
      }
    });
  }
  postNativeIndicator('listening');
}

export function setIdleIndicatorState(state: string): void {
  if (isNativeUi()) {
    postNativeIndicator(state);
    return;
  }
  const label = document.getElementById('kikoe-idle-label');
  if (!label) return;
  const chip = document.getElementById('kikoe-idle');
  if (chip) {
    chip.dataset.state = state;
    chip.classList.toggle('kikoe-chip-error', ERROR_STYLED_STATES.has(state));
    chip.classList.toggle('kikoe-chip-muted', state === 'muted');
    if (chip.classList.contains('kikoe-idle-clickable')) {
      chip.setAttribute('title', state === 'no-token'
        ? 'Open WaniKani API token settings'
        : 'Toggle voice input');
    }
  }
  label.textContent = indicatorLabel(state);
}

// Turns a checkAnswer failure reason into a short, actionable hint shown
// next to the raw heard text (see flashcards.ts's failureReason).
function reasonHint(transcript: TranscriptInfo): string | null {
  if (transcript.reason === 'not-loaded') return 'loading answers…';
  if (transcript.reason === 'wrong-type') {
    return transcript.type === 'reading'
      ? "that's the meaning — say the reading"
      : "that's the reading — say the meaning";
  }
  if (transcript.reason === 'ambiguous-kanji') return "heard the kanji — say the reading again";
  if (transcript.reason === 'no-match') return 'no match';
  // Reveal & Grade cards (see app.js's reveal-mode routing).
  if (transcript.reason === 'say-reveal') return 'say "reveal" to show the answer';
  if (transcript.reason === 'say-grade') return 'say "good" or "bad" to grade';
  return null;
}

function isCorrectionCandidate(transcript: TranscriptInfo): boolean {
  return transcript.reason === 'no-match'
    && typeof transcript.correction?.heard === 'string'
    && typeof transcript.correction?.intended === 'string'
    && !!transcript.correction.heard.trim()
    && !!transcript.correction.intended.trim();
}

function requestCorrection(transcript: TranscriptInfo): void {
  const heard = transcript.correction?.heard.trim();
  const intended = transcript.correction?.intended.trim();
  if (!heard || !intended) return;
  const ok = window.confirm(
    `Create a speech correction?\n\nHeard: ${heard}\nIntended answer: ${intended}`
  );
  if (!ok) return;
  document.dispatchEvent(new CustomEvent('kikoe:addCorrection', {
    detail: { heard, intended },
  }));
}

// Raw text of the last bubble sent to the native host, for the same
// repeated-interim dedup the DOM path does against its previous chip.
let nativeLastRaw: string | null = null;

function logNativeTranscript(settings: Settings, transcript: TranscriptInfo): void {
  const hasNewInfo = transcript.matched || transcript.reason;
  if (transcript.raw === nativeLastRaw && !hasNewInfo) return;
  nativeLastRaw = transcript.raw;

  const isError = transcript.raw.startsWith('!!');
  const hint = transcript.matched ? null : reasonHint(transcript);
  const correction = isCorrectionCandidate(transcript) && transcript.correction
    ? { heard: transcript.correction.heard.trim(), intended: transcript.correction.intended.trim() }
    : null;
  postNativeUi({
    type: 'transcript',
    text: isError ? transcript.raw.replace(/^!!\s*|\s*!!$/g, '') : transcript.raw,
    detail: transcript.matched ? `→ ${transcript.matched}` : hint ? `— ${hint}` : null,
    error: isError,
    position: settings.transcript_position === 'bottom' ? 'bottom' : 'top',
    correction,
  });
}

export function logTranscript(settings: Settings, transcript: TranscriptInfo | string | null | undefined): void {
  if (!settings.transcript) return;
  if (isNativeUi()) {
    logNativeTranscript(settings, typeof transcript === 'object' && transcript !== null
      ? transcript
      : { raw: String(transcript) });
    return;
  }
  const container = document.querySelector<HTMLElement>('div#kikoe-transcript-container');
  if (!container) return;

  if (typeof transcript !== 'object' || transcript === null) {
    transcript = { raw: String(transcript) };
  }

  const previous = document.getElementById(`transcript-${COUNTER - 1}`);
  // A reason arrives on the same raw text as the interim log that preceded
  // it (see app.js's handleRecognitionResult) — treat it like `matched`
  // below so the hint replaces the bare raw bubble instead of being
  // swallowed by the same-raw dedup.
  const hasNewInfo = transcript.matched || transcript.reason;

  if (previous && transcript.raw === previous.dataset.raw && !hasNewInfo) return;
  if (previous && transcript.raw === previous.dataset.raw && hasNewInfo) {
    clearTranscriptWith(`transcript-${COUNTER - 1}`);
  }

  const isError = transcript.raw.startsWith('!!');
  const displayText = isError
    ? transcript.raw.replace(/^!!\s*|\s*!!$/g, '')
    : transcript.raw;

  const current = COUNTER++;
  const id = `transcript-${current}`;

  const el = document.createElement('div');
  el.dataset.raw = transcript.raw;
  el.id = id;
  el.className = `kikoe-chip ${themeClass(settings)}${isError ? ' kikoe-chip-error' : ''}`;

  if (isCorrectionCandidate(transcript)) {
    const correction = transcript.correction;
    if (!correction) return;
    const onCorrectionRequest = () => requestCorrection(transcript);
    el.classList.add('kikoe-chip-clickable');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', 'Create speech correction');
    el.setAttribute('aria-label', `Create correction from ${correction.heard} to ${correction.intended}`);
    el.addEventListener('click', onCorrectionRequest);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onCorrectionRequest();
      }
    });
  }

  const dot = document.createElement('span');
  dot.className = 'kikoe-chip-dot';
  dot.setAttribute('aria-hidden', 'true');
  el.appendChild(dot);

  const text = document.createElement('span');
  text.textContent = displayText;
  el.appendChild(text);

  if (transcript.matched) {
    const matched = document.createElement('span');
    matched.className = 'kikoe-chip-matched';
    matched.textContent = '→ ' + transcript.matched;
    el.appendChild(matched);
  } else {
    const hint = reasonHint(transcript);
    if (hint) {
      const hintEl = document.createElement('span');
      hintEl.className = 'kikoe-chip-matched';
      hintEl.textContent = '— ' + hint;
      el.appendChild(hintEl);
    }
  }

  container.style.cssText = getContainerStyle(settings);
  container.appendChild(el);

  setTimeout(() => scheduleRemoval(el), TRANSCRIPT_FADE_DELAY_MS);

  const start = current - TRANSCRIPT_MAX_VISIBLE;
  const end = current - 10;
  for (let i = start; i >= end && i >= 0; i--) {
    clearTranscriptWith(`transcript-${i}`);
  }
}
