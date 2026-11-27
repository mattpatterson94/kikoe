// Keep the on-screen keyboard from popping up on its own.
//
// WaniKani and BunPro both focus the answer input whenever a new card appears.
// On a phone or tablet that raises the software keyboard after every "next",
// which is pure noise for someone answering by voice — they have to dismiss it
// each time. Kikoe never focuses the input itself; the site does.
//
// The fix is `inputmode="none"`, which tells the browser to focus the field
// without showing a keyboard. It is only held while focus arrived on its own:
// the moment the user taps the input the original inputmode is restored, so
// typing an answer by hand still works. When that input loses focus the
// suppression comes back for the next card.

const SUPPRESSED = 'none';

// Elements the user has deliberately tapped, which keep their keyboard until
// they leave the field. A WeakSet so a card's discarded input is just dropped.
const userOwned = new WeakSet<HTMLElement>();

// The site's own inputmode (or its absence), restored on a deliberate tap.
const originalMode = new WeakMap<HTMLElement, string | null>();

let installed = false;

function suppress(el: HTMLElement): void {
  if (userOwned.has(el)) return;
  if (el.getAttribute('inputmode') === SUPPRESSED) return;
  if (!originalMode.has(el)) originalMode.set(el, el.getAttribute('inputmode'));
  el.setAttribute('inputmode', SUPPRESSED);
}

function release(el: HTMLElement): void {
  userOwned.add(el);
  if (!originalMode.has(el)) return;
  const original = originalMode.get(el);
  if (original === null || original === undefined) el.removeAttribute('inputmode');
  else el.setAttribute('inputmode', original);
  originalMode.delete(el);
}

function matchingTarget(event: Event, selector: string): HTMLElement | null {
  const target = event.target;
  return target instanceof HTMLElement && target.matches(selector) ? target : null;
}

// Idempotent, and a no-op on devices whose primary pointer is a mouse: there
// is no on-screen keyboard to suppress, and a desktop user may well want
// `inputmode` left alone.
export function suppressAutofocusKeyboard(selector: string, touchPrimary: boolean): void {
  if (installed || !touchPrimary) return;
  installed = true;

  const suppressAll = (): void => {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) suppress(el);
  };

  // The input is replaced as cards change, so keep catching new ones. This
  // runs as a microtask after the site's DOM update, which can already have
  // focused the field — the focusin listener below covers that case.
  new MutationObserver(suppressAll).observe(document.documentElement, { childList: true, subtree: true });
  suppressAll();

  // Capture so this runs before the site's own handlers, and on an input
  // focused in the same task that inserted it.
  document.addEventListener('focusin', (event) => {
    const el = matchingTarget(event, selector);
    if (el) suppress(el);
  }, true);

  // A tap is the user asking for the keyboard. pointerdown lands before the
  // browser's focus handling, so a field that is not yet focused picks up the
  // restored inputmode as it takes focus. One that is already focused (the
  // site's autofocus) would not re-show its keyboard on a tap, so it is
  // blurred here and the tap's own default action focuses it again.
  document.addEventListener('pointerdown', (event) => {
    const el = matchingTarget(event, selector);
    if (!el) return;
    // Blur first: its focusout re-suppresses, and release must come after.
    if (document.activeElement === el) el.blur();
    release(el);
  }, true);

  document.addEventListener('focusout', (event) => {
    const el = matchingTarget(event, selector);
    if (!el) return;
    userOwned.delete(el);
    suppress(el);
  }, true);
}
