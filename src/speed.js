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

export function startSpeedEnhancer(getSettingsFn) {
  let currentContainer = null;
  let attrObserver = null;

  function onResult(container) {
    const result = container.getAttribute('correct');
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

    attrObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'correct') {
          onResult(container);
        }
      }
    });
    attrObserver.observe(container, { attributes: true });
  }

  function scan() {
    const el = document.querySelector('.quiz-input__input-container');
    if (el) attach(el);
  }

  // Re-scan when WaniKani's SPA swaps the quiz container.
  const pageObserver = new MutationObserver(scan);
  pageObserver.observe(document.body, { childList: true, subtree: true });
  scan();

  // Exposed for testing.
  return { scan, _getContainer: () => currentContainer };
}
