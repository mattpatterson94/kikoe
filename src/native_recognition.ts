// Recognizer backed by a native host app instead of Web Speech. The iOS
// spike (ios-spike/) wraps WaniKani/BunPro in a WKWebView and runs the
// microphone through Apple's Speech framework, exposing it to the page as the
// `kikoeSpeech` script message handler. Commands go out over that handler;
// transcripts come back as `kikoe:nativeSpeech` events the host dispatches on
// the document via evaluateJavaScript.
//
// Unlike Web Speech, the native side keeps one continuous session alive on
// its own (audio engine running, recognition requests swapped underneath),
// so there's no onend/auto-restart dance here: start/stop/restart are
// explicit, and the host only reports results and errors.
import type { RecognitionControls, TranscriptCallback } from './recognition';

export const NATIVE_SPEECH_EVENT = 'kikoe:nativeSpeech';

interface MessageHandler {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: Record<string, MessageHandler | undefined> };
  }
}

export type NativeSpeechCommand =
  | { type: 'start'; lang: string; hints: string[] }
  | { type: 'stop' }
  // End the current recognition request and start a fresh one with the same
  // locale and hints, discarding the rest of the utterance in flight.
  | { type: 'reset' }
  | { type: 'hints'; hints: string[] };

export type NativeSpeechEvent =
  | { type: 'result'; transcripts: string[]; isFinal: boolean; resultId: string }
  | { type: 'error'; error: SpeechRecognitionErrorCode };

export function getNativeSpeechHandler(): MessageHandler | null {
  const handler = window.webkit?.messageHandlers?.kikoeSpeech;
  return handler && typeof handler.postMessage === 'function' ? handler : null;
}

// What the native recognizer should bias toward for this card: the accepted
// answers in the language being spoken. Reading cards also get the prompt
// itself, since Japanese recognizers commonly emit the kanji spelling of a
// word rather than its kana, and the matcher already converts that back.
// Hiragana, katakana and CJK ideographs. BunPro's prompt is a card id
// ("806:0"), not text the user could say, so only Japanese prompts are hinted.
const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

export function answerHints(ctx: {
  type?: string | null;
  prompt?: string | null;
  readings?: string[];
  meanings?: string[];
} | null | undefined): string[] {
  if (!ctx) return [];
  const hints = ctx.type === 'reading'
    ? [...(ctx.readings ?? []), ...(ctx.prompt && JAPANESE_RE.test(ctx.prompt) ? [ctx.prompt] : [])]
    : [...(ctx.meanings ?? [])];
  return [...new Set(hints.map(h => h.trim()).filter(Boolean))];
}

export function createNativeRecognition(
  handler: MessageHandler,
  getLang: () => string,
  callback: TranscriptCallback,
  onError?: (error: SpeechRecognitionErrorCode) => void,
): RecognitionControls {
  let paused = true;
  let hints: string[] = [];

  function post(command: NativeSpeechCommand): void {
    try {
      handler.postMessage(command);
    } catch (err) {
      console.error('[kikoe] native speech bridge failed:', err);
    }
  }

  function start(): void {
    paused = false;
    recognition.lang = getLang();
    post({ type: 'start', lang: recognition.lang, hints });
  }

  document.addEventListener(NATIVE_SPEECH_EVENT, (e) => {
    const event = (e as CustomEvent<NativeSpeechEvent | null>).detail;
    if (!event) return;
    if (event.type === 'result') {
      // Paused means silence is expected (muted, hidden, help open); a result
      // still in flight from before the pause must not answer a card.
      if (paused || !Array.isArray(event.transcripts)) return;
      const transcripts = event.transcripts.map(t => String(t).trim());
      callback(transcripts, !!event.isFinal, String(event.resultId));
    } else if (event.type === 'error') {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
        paused = true;
      }
      console.error('[kikoe] error occurred in native recognition:', event.error);
      onError?.(event.error);
    }
  });

  const recognition: RecognitionControls = {
    lang: getLang(),
    pause() {
      paused = true;
      post({ type: 'stop' });
    },
    resume: start,
    // The host treats a start while already running as "reconfigure": it
    // swaps the request for one with the new locale and hints and drops
    // audio buffered for the previous card.
    restart: start,
    isPaused() {
      return paused;
    },
    endUtterance() {
      if (!paused) post({ type: 'reset' });
    },
    setHints(next: string[]) {
      if (next.length === hints.length && next.every((h, i) => h === hints[i])) return;
      hints = [...next];
      if (!paused) post({ type: 'hints', hints });
    },
  };

  return recognition;
}
