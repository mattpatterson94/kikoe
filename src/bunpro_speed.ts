// BunPro turbo mode / speed enhancements — mirrors speed.ts.
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
//   turbo           (bool)   – auto-advance to next card on correct answer
//   speed_show_info (bool)   – on a wrong answer, open item info and switch
//                              the card to the correct answer

import { clickNext, clickInfo, clickAnswer } from './bunpro';
import { debugLog } from './logger';
import type { Settings } from './settings';

const RESULT_DELAY_MS = 100;

// How long after opening item info to press Answer. Opening the panel
// re-renders the card, and doing that over the correct answer would put the
// answer given back on top of it — so Answer goes second, once the panel's
// render has settled.
const ANSWER_AFTER_INFO_MS = 200;

export interface BunproSpeedEnhancer {
  scan(): void;
  stop(): void;
  _getContainer(): HTMLElement | null;
}

export function startSpeedEnhancer(getSettingsFn: () => Settings): BunproSpeedEnhancer {
  let currentMeta: HTMLElement | null = null;
  let attrObserver: MutationObserver | null = null;
  let lastResultKey: string | null = null;

  function getCardId(meta: HTMLElement): number | string | null {
    try {
      return (JSON.parse(meta.dataset.metaInfo ?? 'null') as { id?: number | string } | null)?.id ?? null;
    } catch {
      return null;
    }
  }

  function onResult(meta: HTMLElement): void {
    if (meta.dataset.metaIsPostAttempt !== 'true') return;

    const result = meta.dataset.metaIsCorrect;
    const cardId = getCardId(meta);
    // Both watched attributes mutate on an answer — handle each result once
    // (the submission count distinguishes repeat attempts on the same card).
    const key = `${cardId}:${meta.dataset.metaTotalSubmissionsCount ?? ''}:${result}`;
    if (key === lastResultKey) return;
    lastResultKey = key;

    const s = getSettingsFn();

    if (result === 'true' && s.turbo) {
      setTimeout(() => {
        // BunPro's native Lightning Mode may have already advanced.
        if (getCardId(meta) !== cardId) return;
        clickNext();
      }, RESULT_DELAY_MS);
    }
    if (result === 'false' && s.speed_show_info) {
      setTimeout(() => {
        clickInfo();
        setTimeout(() => {
          // The user may already have moved on to the next card.
          if (getCardId(meta) !== cardId) return;
          clickAnswer();
        }, ANSWER_AFTER_INFO_MS);
      }, RESULT_DELAY_MS);
    }
  }

  function attach(meta: HTMLElement): void {
    if (meta === currentMeta) return;
    currentMeta = meta;
    attrObserver?.disconnect();
    debugLog('bunpro speed enhancer attached');

    attrObserver = new MutationObserver(() => onResult(meta));
    attrObserver.observe(meta, {
      attributes: true,
      attributeFilter: ['data-meta-is-correct', 'data-meta-is-post-attempt'],
    });
  }

  function scan(): void {
    const el = document.querySelector<HTMLElement>('#quiz-metadata-element');
    if (el) attach(el);
  }

  // Re-scan when BunPro's SPA swaps the metadata element.
  const pageObserver = new MutationObserver(scan);
  pageObserver.observe(document.body, { childList: true, subtree: true });
  scan();

  function stop(): void {
    pageObserver.disconnect();
    attrObserver?.disconnect();
  }

  // scan/stop/_getContainer exposed for testing.
  return { scan, stop, _getContainer: () => currentMeta };
}
