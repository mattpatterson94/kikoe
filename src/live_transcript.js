const STYLE_ID = 'kikoe-transcript-styles';

function injectStyles() {
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
    .kikoe-idle .kikoe-chip-dot {
      width: 6px;
      height: 6px;
    }
  `;
  document.head.appendChild(style);
}

function getContainerStyle(settings) {
  const position = settings.transcript_position;
  let posStyle;
  if (position === 'bottom') {
    posStyle = 'bottom: 16px;';
  } else if (position === 'center') {
    posStyle = 'top: 50%; transform: translateY(-50%);';
  } else {
    posStyle = 'top: 16px;';
  }
  return `width: 100%; position: fixed; z-index: 2147483647; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; left: 0; ${posStyle}`;
}

function themeClass(settings) {
  const t = settings.transcript_theme;
  if (t === 'dark' || t === 'light') return `kikoe-theme-${t}`;
  return 'kikoe-theme-system';
}

export function createTranscriptContainer(settings) {
  injectStyles();
  const container = document.createElement('div');
  container.id = 'kikoe-transcript-container';
  container.style.cssText = getContainerStyle(settings);
  document.body.appendChild(container);
}

let COUNTER = 1;

export function clearTranscript() {
  const container = document.querySelector('div#kikoe-transcript-container');
  if (!container) return;
  container.textContent = '';
}

function clearTranscriptWith(id) {
  const t = document.getElementById(id);
  if (t && t.parentNode) t.parentNode.removeChild(t);
}

function scheduleRemoval(el) {
  el.style.opacity = '0';
  el.style.transform = 'translateY(-6px) scale(0.95)';
  const remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
  el.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 450);
}

export function showIdleIndicator(settings) {
  if (!settings.transcript) return;
  if (document.getElementById('kikoe-idle')) return;

  const el = document.createElement('div');
  el.id = 'kikoe-idle';
  el.className = `kikoe-chip ${themeClass(settings)} kikoe-idle`;
  el.style.cssText = 'position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;';

  const dot = document.createElement('span');
  dot.className = 'kikoe-chip-dot';
  dot.setAttribute('aria-hidden', 'true');
  el.appendChild(dot);

  const label = document.createElement('span');
  label.id = 'kikoe-idle-label';
  label.textContent = 'Listening';
  el.appendChild(label);

  document.body.appendChild(el);
}

const ERROR_STYLED_STATES = new Set(['error', 'mic-denied', 'no-mic', 'unsupported-browser']);

export function setIdleIndicatorState(state) {
  const label = document.getElementById('kikoe-idle-label');
  if (!label) return;
  document.getElementById('kikoe-idle')?.classList.toggle('kikoe-chip-error', ERROR_STYLED_STATES.has(state));
  if (state === 'loading') label.textContent = 'Loading…';
  else if (state === 'retrying') label.textContent = 'Retrying…';
  else if (state === 'restarting') label.textContent = 'Restarting…';
  else if (state === 'reconnecting') label.textContent = 'Reconnecting…';
  else if (state === 'paused') label.textContent = 'Paused';
  else if (state === 'no-token') label.textContent = '⚠ No API token';
  else if (state === 'unsupported') label.textContent = '⚠ Unsupported card type';
  else if (state === 'unsupported-browser') label.textContent = '⚠ Voice recognition not supported by this browser';
  else if (state === 'mic-denied') label.textContent = '⚠ Microphone access denied';
  else if (state === 'no-mic') label.textContent = '⚠ No microphone found';
  else if (state === 'error') label.textContent = '⚠ Subjects failed to load';
  else label.textContent = 'Listening';
}

export function logTranscript(settings, transcript) {
  if (!settings.transcript) return;
  const container = document.querySelector('div#kikoe-transcript-container');
  if (!container) return;

  if (typeof transcript !== 'object' || transcript === null) {
    transcript = { raw: String(transcript) };
  }

  const previous = document.getElementById(`transcript-${COUNTER - 1}`);

  if (previous && transcript.raw === previous.raw && !transcript.matched) return;
  if (previous && transcript.raw === previous.raw && transcript.matched) {
    clearTranscriptWith(`transcript-${COUNTER - 1}`);
  }

  const isError = transcript.raw.startsWith('!!');
  const displayText = isError
    ? transcript.raw.replace(/^!!\s*|\s*!!$/g, '')
    : transcript.raw;

  const current = COUNTER++;
  const id = `transcript-${current}`;

  const el = document.createElement('div');
  el.raw = transcript.raw;
  el.id = id;
  el.className = `kikoe-chip ${themeClass(settings)}${isError ? ' kikoe-chip-error' : ''}`;

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
  }

  container.style.cssText = getContainerStyle(settings);
  container.appendChild(el);

  setTimeout(() => scheduleRemoval(el), settings.transcript_delay * 1000);

  const start = current - settings.transcript_count;
  const end = current - 10;
  for (let i = start; i >= end && i >= 0; i--) {
    clearTranscriptWith(`transcript-${i}`);
  }
}
