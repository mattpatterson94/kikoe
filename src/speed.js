// Adapted from "WaniKani Speed Fixed" userscript.
// Watches the `correct` attribute on .quiz-input__input-container.
// When WaniKani evaluates an answer it sets correct="true"|"false" on that
// element; we then auto-advance or auto-open item info based on settings.
//
// Configurable via settings:
//   lightning       (bool)   – auto-advance to next card on correct answer
//   lightning_delay (number) – seconds to wait before advancing (default 0.1)
//   speed_show_info (bool)   – auto-open item info panel on wrong answer
//   mistake_delay   (number) – seconds to wait before opening info (default 0.1)

import { clickNext, clickInfo } from './wanikani.js';
import { debugLog } from './logger.js';

export function startSpeedEnhancer(getSettingsFn) {
  let currentContainer = null;
  let attrObserver = null;

  // WaniKani has used both 'correct' and 'data-correct' across versions.
  const RESULT_ATTRS = ['correct', 'data-correct'];

  function getResult(container) {
    for (const attr of RESULT_ATTRS) {
      const v = container.getAttribute(attr);
      if (v !== null) return v;
    }
    return null;
  }

  function onResult(container) {
    const result = getResult(container);
    const s = getSettingsFn();

    if (result === 'true' && s.lightning) {
      setTimeout(clickNext, s.lightning_delay * 1000);
    }
    if (result === 'false' && s.speed_show_info) {
      setTimeout(clickInfo, s.mistake_delay * 1000);
    }
  }

  function attach(container) {
    if (container === currentContainer) return;
    currentContainer = container;
    attrObserver?.disconnect();
    debugLog('speed enhancer attached to', container.className || container.tagName);

    attrObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && RESULT_ATTRS.includes(m.attributeName)) {
          onResult(container);
        }
      }
    });
    attrObserver.observe(container, { attributes: true });
  }

  function scan() {
    // Try the class-based selector first, then fall back to the Stimulus
    // controller attribute in case WaniKani renamed the CSS class.
    const el = document.querySelector('.quiz-input__input-container')
            ?? document.querySelector('[data-controller~="quiz-input"]');
    if (el) attach(el);
  }

  // Re-scan when WaniKani's SPA swaps the quiz container.
  const pageObserver = new MutationObserver(scan);
  pageObserver.observe(document.body, { childList: true, subtree: true });
  scan();

  // Exposed for testing.
  return { scan, _getContainer: () => currentContainer };
}
