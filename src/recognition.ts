import { createNativeRecognition, getNativeSpeechHandler } from './native_recognition';
import type { Settings } from './settings';

// Short utterances and common on'yomi (かい, けい, どう, ...) are frequently
// autocorrected by the recognizer into an unrelated real word, since its
// language model favors known vocabulary over an isolated mora. The correct
// reading is often still present among the engine's lower-ranked guesses, so
// ask for several and let the caller check all of them instead of only the
// top pick.
const MAX_ALTERNATIVES = 5;

// Errors after which retrying without backoff would just hot-loop against a
// permission dialog or a missing device — the auto-restart in onend must stop.
const FATAL_ERRORS = new Set<SpeechRecognitionErrorCode>([
  'not-allowed', 'service-not-allowed', 'audio-capture',
]);

// Unhealthy sessions back off geometrically instead of restarting
// immediately, so a repeating failure doesn't spin the recognizer in a loop.
const RESTART_BACKOFF_MS = 1000;
const MAX_RESTART_BACKOFF_MS = 8000;

// What counts as unhealthy. The engine ends sessions on its own routinely —
// an idle timeout during silence is normal and must restart immediately, or
// the mic would be dead for seconds at a time whenever the user stops
// talking. A session that ends almost as soon as it started is the opposite:
// not the idle timeout, but a failure that will repeat. That distinction is
// what lets the backoff cover every cause instead of only 'network'.
const MIN_HEALTHY_SESSION_MS = 1000;

// Chrome can leave a session nominally open while its audio track is dead —
// device switch, sleep/resume, Bluetooth handoff. It emits no results, no
// error, and crucially no 'end', so the auto-restart below never runs and
// the indicator goes on claiming to listen over nothing. Short of a page
// reload nothing recovers from this today.
//
// The timeout has to sit above a plausible silent gap. It mostly does so by
// construction: 'audiostart' fires every time capture begins, so the engine's
// own routine session cycling keeps a healthy-but-silent recognizer looking
// alive, and only a completely inert one trips this. Worth validating
// against real session traces before tightening.
const LIVENESS_TIMEOUT_MS = 45000;
const LIVENESS_CHECK_INTERVAL_MS = 5000;

// How hard a contextual hint pulls the on-device model toward it. The spec
// allows 0–10; a moderate boost lets a hinted reading win a near tie without
// drowning out an answer that really was different.
const HINT_BOOST = 3;

// Browser recognizer options, the Web Speech counterparts of the iOS app's
// Advanced settings. Each one is feature-detected and silently skipped by an
// engine that lacks it (Safari, older Chrome):
// - onDevice: SpeechRecognition.processLocally. Falls back to the cloud
//   recognizer for any language the browser reports it can't do locally.
// - contextualHints: SpeechRecognition.phrases, seeded per card like the
//   native host's contextual strings. Chrome only supports these on-device.
// - noiseReduction: capture through getUserMedia with noise suppression and
//   echo cancellation and pass that track to start().
export interface WebSpeechOptions {
  onDevice: boolean;
  contextualHints: boolean;
  noiseReduction: boolean;
}

const DEFAULT_WEB_SPEECH_OPTIONS: WebSpeechOptions = {
  onDevice: false,
  contextualHints: false,
  noiseReduction: false,
};

export function webSpeechOptions(
  settings: Pick<Settings, 'recognizer' | 'contextual_hints' | 'noise_reduction'>,
): WebSpeechOptions {
  return {
    onDevice: settings.recognizer === 'on_device',
    contextualHints: !!settings.contextual_hints,
    noiseReduction: !!settings.noise_reduction,
  };
}

// Not in @types/dom-speech-recognition yet.
interface SpeechRecognitionPhraseLike {
  readonly phrase: string;
  readonly boost: number;
}
type PhraseConstructor = new (phrase: string, boost?: number) => SpeechRecognitionPhraseLike;
interface PhraseCapable {
  phrases: SpeechRecognitionPhraseLike[];
}

function phraseConstructor(): PhraseConstructor | null {
  const ctor = (window as unknown as { SpeechRecognitionPhrase?: unknown }).SpeechRecognitionPhrase;
  return typeof ctor === 'function' ? ctor as PhraseConstructor : null;
}

export type TranscriptCallback = (transcripts: string[], isFinal: boolean, resultId: string) => void;

// The surface app.ts drives, shared by the Web Speech recognizer below and the
// native-host one in native_recognition.ts. setHints is optional: only an
// engine that supports biasing (contextual strings) implements it.
export interface RecognitionControls {
  lang: string;
  pause(): void;
  resume(): void;
  restart(): void;
  isPaused(): boolean;
  setHints?(hints: string[]): void;
  // Ends the in-progress utterance so speech still arriving for it is dropped
  // rather than reaching the next card. Only the native host can do this.
  endUtterance?(): void;
}

// The Web Speech recognizer, extended with pause/resume/restart controls that
// manage the auto-restart behavior wired up in createRecognition.
export interface KikoeRecognition extends SpeechRecognition, RecognitionControls {}

export function createRecognition(
  lang: string | (() => string),
  callback: TranscriptCallback,
  onError?: (error: SpeechRecognitionErrorCode) => void,
  getOptions: () => WebSpeechOptions = () => DEFAULT_WEB_SPEECH_OPTIONS,
): RecognitionControls | null {
  // Accept a function so callers can supply a live language getter; this ensures
  // every auto-restart picks up the correct language even if setLanguage was
  // called with a stale value during a DOM transition.
  const getLang = typeof lang === 'function' ? lang : () => lang;

  // Inside a native host app (the iOS spike) the microphone belongs to the
  // host, which exposes its own recognizer; prefer it over Web Speech.
  const nativeHandler = getNativeSpeechHandler();
  if (nativeHandler) return createNativeRecognition(nativeHandler, getLang, callback, onError);

  if (!('webkitSpeechRecognition' in window)) {
    console.error('[kikoe] web speech not supported by this browser!');
    return null;
  }

  const recognition = new webkitSpeechRecognition() as KikoeRecognition;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = MAX_ALTERNATIVES;
  recognition.lang = getLang();
  let shouldAutoRestart = true;
  // Consecutive sessions that ended unhealthily; drives the restart backoff.
  let unhealthyRestarts = 0;
  let sessionStartedAt = 0;
  let sawErrorThisSession = false;
  // Last sign of life from the engine, for the liveness watchdog below.
  let lastActivityAt = Date.now();
  let sessionId = 0;
  const start = recognition.start.bind(recognition);
  const stop = recognition.stop.bind(recognition);
  // stop() keeps the session alive until the engine has finished processing
  // whatever audio it has buffered, which is exactly the wrong trade for a
  // restart: the buffered audio belongs to the card being left behind, and
  // waiting for it leaves the mic dead while the user is already answering the
  // next one. abort() ends the session at once. Guarded because the interface
  // is optional on non-Chromium implementations.
  const abort = typeof recognition.abort === 'function' ? recognition.abort.bind(recognition) : null;

  // ── optional engine features ────────────────────────────────────────────
  const supportsLocal = 'processLocally' in recognition;
  const Phrase = phraseConstructor();
  const supportsPhrases = !!Phrase && 'phrases' in recognition;
  // Languages the browser turned down for local recognition this page load;
  // those go back to the cloud recognizer rather than failing every session.
  const localUnavailable = new Set<string>();
  let phrasesRejected = false;
  let usingLocal = false;
  let hints: string[] = [];
  let appliedHints = '';
  // The noise-suppressed capture track, shared by every session until a
  // pause releases it (so the browser's mic indicator goes off with Kikoe).
  let noiseTrack: MediaStreamTrack | null = null;
  let noiseTrackPending = false;
  let noiseTrackFailed = false;

  function hintsInEffect(options: WebSpeechOptions): boolean {
    return options.contextualHints && supportsPhrases && usingLocal && !phrasesRejected;
  }

  function applyOptions(): WebSpeechOptions {
    const options = getOptions();
    const lang = recognition.lang;
    usingLocal = supportsLocal && options.onDevice && !localUnavailable.has(lang);
    if (supportsLocal) recognition.processLocally = usingLocal;
    if (supportsPhrases && Phrase) {
      const active = hintsInEffect(options) ? hints : [];
      (recognition as unknown as PhraseCapable).phrases = active.map((h) => new Phrase(h, HINT_BOOST));
      appliedHints = active.join('\n');
    }
    return options;
  }

  function releaseNoiseTrack(): void {
    noiseTrack?.stop();
    noiseTrack = null;
  }

  // getUserMedia is asynchronous and start() isn't, so the first session
  // after turning this on runs on the default capture; once the track is
  // ready the session restarts onto it.
  function ensureNoiseTrack(): MediaStreamTrack | null {
    if (noiseTrack?.readyState === 'ended') noiseTrack = null;
    if (noiseTrack || noiseTrackPending || noiseTrackFailed) return noiseTrack;
    if (!navigator.mediaDevices?.getUserMedia) {
      noiseTrackFailed = true;
      return null;
    }
    noiseTrackPending = true;
    navigator.mediaDevices.getUserMedia({
      audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
    }).then((stream) => {
      noiseTrackPending = false;
      const [track] = stream.getAudioTracks();
      if (!track) return;
      if (!shouldAutoRestart || !getOptions().noiseReduction) {
        track.stop();
        return;
      }
      noiseTrack = track;
      safeAbort();
    }, (err: unknown) => {
      noiseTrackPending = false;
      noiseTrackFailed = true;
      console.error('[kikoe] noise-reduced capture unavailable; using default microphone:', err);
    });
    return null;
  }

  function safeStart(): void {
    recognition.lang = getLang();
    sessionStartedAt = Date.now();
    sawErrorThisSession = false;
    const options = applyOptions();
    if (!options.noiseReduction) releaseNoiseTrack();
    const track = options.noiseReduction ? ensureNoiseTrack() : null;
    try {
      if (track) start(track);
      else start();
      sessionId++;
    } catch (err) {
      if (!(err instanceof Error) || err.name !== 'InvalidStateError') throw err;
    }
  }

  function safeStop(): void {
    try {
      stop();
    } catch (err) {
      if (!(err instanceof Error) || err.name !== 'InvalidStateError') throw err;
    }
  }

  function safeAbort(): void {
    if (!abort) {
      safeStop();
      return;
    }
    try {
      abort();
    } catch (err) {
      if (!(err instanceof Error) || err.name !== 'InvalidStateError') throw err;
    }
  }

  // Capture beginning is a sign of life even when nothing is said, so it
  // keeps a silent-but-healthy recognizer from tripping the watchdog.
  recognition.onaudiostart = () => {
    lastActivityAt = Date.now();
  };

  recognition.onresult = (event) => {
    unhealthyRestarts = 0;
    sawErrorThisSession = false;
    lastActivityAt = Date.now();

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const result = event.results[i];
      // Interim results are only ever given one alternative by the engine;
      // final results may carry up to maxAlternatives, ranked by confidence.
      const transcripts = Array.from(result, alt => alt.transcript.trim());
      callback(transcripts, result.isFinal, `${sessionId}:${i}`);
    }
  };

  recognition.onerror = (event) => {
    // 'no-speech' is ordinary silence, and 'aborted' is restart() tearing the
    // session down on purpose — neither is a fault, and the auto-restart in
    // onend already brings the recognizer back.
    if (event.error === 'no-speech' || event.error === 'aborted') {
      return;
    }
    // On-device asked for a language this browser can't do locally (model
    // not installed, or not offered at all): use the cloud recognizer for it.
    if (event.error === 'language-not-supported' && usingLocal) {
      console.warn(`[kikoe] on-device recognition unavailable for ${recognition.lang}; using the browser's default recognizer`);
      localUnavailable.add(recognition.lang);
      return;
    }
    if ((event.error as string) === 'phrases-not-supported') {
      console.warn('[kikoe] this recognizer does not accept contextual hints; continuing without them');
      phrasesRejected = true;
      return;
    }
    console.error('[kikoe] error occurred in recognition:', event.error);

    if (FATAL_ERRORS.has(event.error)) {
      shouldAutoRestart = false;
    } else {
      sawErrorThisSession = true;
    }

    onError?.(event.error);
  };

  recognition.onend = () => {
    // A session is unhealthy if it reported an error or barely ran at all.
    // Anything else — including the engine's ordinary idle timeout during
    // silence — resets the streak and restarts without delay.
    const tooShort = Date.now() - sessionStartedAt < MIN_HEALTHY_SESSION_MS;
    if (sawErrorThisSession || tooShort) unhealthyRestarts++;
    else unhealthyRestarts = 0;

    if (!shouldAutoRestart) return;
    const delay = Math.min(unhealthyRestarts * RESTART_BACKOFF_MS, MAX_RESTART_BACKOFF_MS);
    if (delay > 0) {
      setTimeout(() => { if (shouldAutoRestart) safeStart(); }, delay);
    } else {
      safeStart();
    }
  };

  // Paused covers every case where silence is expected and a restart would
  // be wrong — user mute, hidden or blurred tab, open help panel, denied
  // microphone — because app.ts pauses the recognizer for all of them.
  setInterval(() => {
    if (recognition.isPaused()) return;
    if (Date.now() - lastActivityAt < LIVENESS_TIMEOUT_MS) return;
    console.error('[kikoe] recognition went silent; restarting');
    // Reset first: restart() is asynchronous, and leaving the stale
    // timestamp in place would fire this again on the next tick.
    lastActivityAt = Date.now();
    recognition.restart();
  }, LIVENESS_CHECK_INTERVAL_MS);

  // Explicit starts get a fresh liveness window: coming back from a pause
  // that lasted longer than the timeout must not read as a stall. The
  // auto-restart in onend deliberately doesn't do this — a recognizer that
  // keeps restarting but never captures anything is exactly what the
  // watchdog is for.
  recognition.start = () => {
    shouldAutoRestart = true;
    lastActivityAt = Date.now();
    safeStart();
  };

  recognition.pause = () => {
    shouldAutoRestart = false;
    safeStop();
    releaseNoiseTrack();
  };

  recognition.resume = () => {
    shouldAutoRestart = true;
    lastActivityAt = Date.now();
    safeStart();
  };

  recognition.restart = () => {
    shouldAutoRestart = true;
    safeAbort();
  };

  recognition.isPaused = () => {
    return !shouldAutoRestart;
  };

  // Phrases are read when a session starts, so new hints only reach the
  // engine on a restart. That's only worth doing when they're in effect:
  // otherwise the next routine restart picks them up for free.
  if (supportsPhrases) {
    recognition.setHints = (next: string[]) => {
      hints = [...next];
      if (!hintsInEffect(getOptions())) return;
      if (hints.join('\n') === appliedHints || !shouldAutoRestart) return;
      safeAbort();
    };
  }

  return recognition;
}

export function setLanguage(recognition: RecognitionControls, newLanguage: string): void {
  if (recognition.lang != newLanguage) {
    recognition.lang = newLanguage;
    if (!recognition.isPaused?.()) recognition.restart();
  }
}
