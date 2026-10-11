// Overlay bridge for the native host (the iOS app in ios/). There, the
// listening indicator, live transcript, correction prompt and help panel are
// drawn natively in SwiftUI rather than as DOM chips over the site, so
// live_transcript.ts and help.ts post their state to the host's `kikoeUI`
// message handler instead of rendering. Taps on the native controls come back
// as `kikoe:nativeUi` events on the document. Browsers never expose the
// handler, so Chrome and Safari keep the DOM overlays.
import type { MessageHandler } from './native_recognition';

export const NATIVE_UI_EVENT = 'kikoe:nativeUi';

export type IndicatorTone = 'normal' | 'error' | 'muted';

export type NativeUiMessage =
  | { type: 'indicator'; state: string; label: string; tone: IndicatorTone }
  | {
      type: 'transcript';
      text: string;
      // The "→ answer" or hint the DOM chip shows in lighter text after the words.
      detail: string | null;
      error: boolean;
      position: 'top' | 'bottom';
      // Present when tapping the bubble should offer to save a correction.
      correction: { heard: string; intended: string } | null;
    }
  | { type: 'clearTranscript' }
  | { type: 'helpButton'; visible: boolean }
  | {
      type: 'help';
      open: true;
      language: string;
      commands: { phrases: string; description: string }[];
      tips: string[];
      guideUrl: string;
    }
  | { type: 'help'; open: false }
  | { type: 'helpHint'; text: string };

export type NativeUiAction = 'indicatorTapped' | 'helpButtonTapped' | 'helpDismissed';

const NATIVE_UI_ACTIONS: readonly string[] = ['indicatorTapped', 'helpButtonTapped', 'helpDismissed'];

export function getNativeUiHandler(): MessageHandler | null {
  const handler = window.webkit?.messageHandlers?.kikoeUI;
  return handler && typeof handler.postMessage === 'function' ? handler : null;
}

export function isNativeUi(): boolean {
  return getNativeUiHandler() !== null;
}

export function postNativeUi(message: NativeUiMessage): void {
  const handler = getNativeUiHandler();
  if (!handler) return;
  try {
    handler.postMessage(message);
  } catch (err) {
    console.error('[kikoe] native UI bridge failed:', err);
  }
}

// One callback per action: the overlay modules re-register on every
// (re)render, and only the latest registration should fire.
const actionHandlers = new Map<NativeUiAction, () => void>();
let listening = false;

function isNativeUiAction(value: unknown): value is NativeUiAction {
  return typeof value === 'string' && NATIVE_UI_ACTIONS.includes(value);
}

export function onNativeUiAction(action: NativeUiAction, handler: () => void): void {
  actionHandlers.set(action, handler);
  if (listening) return;
  listening = true;
  document.addEventListener(NATIVE_UI_EVENT, (e) => {
    const action = (e as CustomEvent<{ action?: unknown } | null>).detail?.action;
    if (isNativeUiAction(action)) actionHandlers.get(action)?.();
  });
}
