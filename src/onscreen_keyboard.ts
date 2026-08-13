// Observing the on-screen (software) keyboard.
//
// iOS keeps the *layout* viewport at full height while the on-screen keyboard
// is up and shrinks only the *visual* viewport, so visualViewport.height is the
// one signal that reports the keyboard showing or hiding — nothing else in the
// platform exposes it. Callers use this to tell "focus left the document
// because the keyboard retracted" apart from "focus left because the user's
// attention moved to another app".

// How long after the keyboard retracts a focus change can still plausibly be
// its doing. Comfortably longer than iOS's retract animation, since the blur
// arrives first and the resize only lands once the keyboard has moved.
const RETRACT_SETTLE_MS = 1200;

export function isTouchPrimaryDevice(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

// Whether the keyboard is observable at all here. Callers need to distinguish
// "the keyboard definitely wasn't involved" from "no idea" — those warrant
// different fallbacks.
export function isOnscreenKeyboardObservable(): boolean {
  return !!window.visualViewport;
}

let watching = false;
let justRetracted = false;
let retractTimer: ReturnType<typeof setTimeout> | undefined;

// Idempotent, and a no-op where visualViewport is unavailable — there
// keyboardJustRetracted() stays false and isOnscreenKeyboardObservable()
// reports why.
export function watchOnscreenKeyboard(): void {
  if (watching) return;
  const vv = window.visualViewport;
  if (!vv) return;
  watching = true;
  let lastHeight = vv.height;
  vv.addEventListener('resize', () => {
    // Growing back is the keyboard retracting; shrinking is it appearing.
    if (vv.height > lastHeight) {
      justRetracted = true;
      clearTimeout(retractTimer);
      retractTimer = setTimeout(() => { justRetracted = false; }, RETRACT_SETTLE_MS);
    }
    lastHeight = vv.height;
  });
}

export function keyboardJustRetracted(): boolean {
  return justRetracted;
}
