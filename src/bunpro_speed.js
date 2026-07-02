// BunPro lightning mode / speed enhancements — mirrors speed.js.
//
// Watches #quiz-metadata-element's data-meta-is-correct / data-meta-is-post-attempt
// attributes. Unlike WaniKani, data-meta-is-correct exists (as "false") before
// any answer is given, so results only count once data-meta-is-post-attempt
// flips to "true".
//
// BunPro also has its own native "Lightning Mode" account setting that
// auto-advances on a correct answer. It can't be assumed on or off, so before
// clicking next we re-check whether the card already changed — skipping the
// click avoids double-advancing into the wrong card.
//
// Configurable via settings (same keys as WaniKani):
//   lightning       (bool)   – auto-advance to next card on correct answer
//   lightning_delay (number) – seconds to wait before advancing (default 0.1)
//   speed_show_info (bool)   – auto-open the hint on wrong answer
//   mistake_delay   (number) – seconds to wait before opening info (default 0.1)

import { clickNext, clickInfo } from './bunpro.js';

export function startSpeedEnhancer(getSettingsFn) {
  let currentMeta = null;
  let attrObserver = null;
  let lastResultKey = null;

  function getCardId(meta) {
    try {
      return JSON.parse(meta.dataset.metaInfo ?? 'null')?.id ?? null;
    } catch {
      return null;
    }
  }

  function onResult(meta) {
    if (meta.dataset.metaIsPostAttempt !== 'true') return;

    const result = meta.dataset.metaIsCorrect;
    const cardId = getCardId(meta);
    // Both watched attributes mutate on an answer — handle each result once
    // (the submission count distinguishes repeat attempts on the same card).
    const key = `${cardId}:${meta.dataset.metaTotalSubmissionsCount ?? ''}:${result}`;
    if (key === lastResultKey) return;
    lastResultKey = key;

    const s = getSettingsFn();

    if (result === 'true' && s.lightning) {
      setTimeout(() => {
        // BunPro's native Lightning Mode may have already advanced.
        if (getCardId(meta) !== cardId) return;
        clickNext();
      }, s.lightning_delay * 1000);
    }
    if (result === 'false' && s.speed_show_info) {
      setTimeout(clickInfo, s.mistake_delay * 1000);
    }
  }

  function attach(meta) {
    if (meta === currentMeta) return;
    currentMeta = meta;
    attrObserver?.disconnect();
    console.log('[wkvi] bunpro speed enhancer attached');

    attrObserver = new MutationObserver(() => onResult(meta));
    attrObserver.observe(meta, {
      attributes: true,
      attributeFilter: ['data-meta-is-correct', 'data-meta-is-post-attempt'],
    });
  }

  function scan() {
    const el = document.querySelector('#quiz-metadata-element');
    if (el) attach(el);
  }

  // Re-scan when BunPro's SPA swaps the metadata element.
  const pageObserver = new MutationObserver(scan);
  pageObserver.observe(document.body, { childList: true, subtree: true });
  scan();

  function stop() {
    pageObserver.disconnect();
    attrObserver?.disconnect();
  }

  // scan/stop/_getContainer exposed for testing.
  return { scan, stop, _getContainer: () => currentMeta };
}
