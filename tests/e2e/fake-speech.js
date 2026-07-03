// Fake webkitSpeechRecognition for driving Kikoe in a real browser without a
// microphone. Injected via Playwright's addInitScript so it exists in every
// page's main world before the extension's injected bundle runs — the
// extension then constructs this class instead of the real recognizer.
//
// Control API (from test code, via page.evaluate):
//   __kikoeSpeech.say('ねこ')                      — one final utterance
//   __kikoeSpeech.say(['ねこ', '寝子'])             — final with ranked alternatives
//   __kikoeSpeech.say('ne', { interim: true })     — interim (single alternative)
//   __kikoeSpeech.error('network')                 — recognition error (+ session end)
//   __kikoeSpeech.state()                          — { running, lang, paused-ish info }
//   __kikoeSpeech.log                              — everything emitted so far
//
// Fidelity notes (mirrors src/recognition.ts's consumption contract):
//   - results are array-likes: event.results[i] iterable via Array.from with
//     { transcript, confidence } alternatives and an isFinal flag
//   - start() while running throws InvalidStateError (safeStart swallows it)
//   - stop()/abort() and errors fire onend asynchronously — the extension's
//     auto-restart and mute logic key off onend
//   - results reset per session, resultIndex points at the new result
(() => {
  if (window.__kikoeSpeech) return;

  const control = {
    instances: [],
    log: [],
    get active() {
      for (let i = control.instances.length - 1; i >= 0; i--) {
        if (control.instances[i]._running) return control.instances[i];
      }
      return null;
    },
    say(transcripts, opts = {}) {
      const inst = control.active;
      if (!inst) throw new Error('[fake-speech] no running recognition instance');
      inst._emitResult(transcripts, opts);
      return control.state();
    },
    error(code, opts = {}) {
      const inst = control.active;
      if (!inst) throw new Error('[fake-speech] no running recognition instance');
      inst._emitError(code, opts);
      return control.state();
    },
    state() {
      const inst = control.instances[control.instances.length - 1] || null;
      return {
        count: control.instances.length,
        running: !!(inst && inst._running),
        lang: inst ? inst.lang : null,
        maxAlternatives: inst ? inst.maxAlternatives : null,
      };
    },
  };

  class FakeSpeechRecognition {
    constructor() {
      this.lang = '';
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 1;
      this.onstart = null;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this._running = false;
      this._results = [];
      control.instances.push(this);
      control.log.push({ t: 'new' });
    }

    start() {
      if (this._running) {
        throw new DOMException('recognition has already started', 'InvalidStateError');
      }
      this._running = true;
      this._results = [];
      control.log.push({ t: 'start', lang: this.lang });
      setTimeout(() => { if (this._running) this.onstart?.({}); }, 0);
    }

    stop() {
      if (!this._running) return;
      this._running = false;
      control.log.push({ t: 'stop' });
      setTimeout(() => this.onend?.({}), 0);
    }

    abort() {
      this.stop();
    }

    _emitResult(transcripts, { interim = false, confidence = 0.9 } = {}) {
      const alts = (Array.isArray(transcripts) ? transcripts : [transcripts])
        .slice(0, Math.max(this.maxAlternatives, 1))
        .map((transcript, i) => ({ transcript, confidence: confidence - i * 0.05 }));
      const result = alts;
      result.isFinal = !interim;

      let results, resultIndex;
      if (interim) {
        results = [...this._results, result];
        resultIndex = this._results.length;
      } else {
        this._results.push(result);
        results = [...this._results];
        resultIndex = this._results.length - 1;
      }
      control.log.push({
        t: 'result', lang: this.lang, interim,
        alts: alts.map(a => a.transcript),
      });
      this.onresult?.({ resultIndex, results });
    }

    _emitError(code, { end = true } = {}) {
      control.log.push({ t: 'error', code });
      this.onerror?.({ error: code });
      if (end && this._running) {
        this._running = false;
        setTimeout(() => this.onend?.({}), 0);
      }
    }
  }

  window.webkitSpeechRecognition = FakeSpeechRecognition;
  window.SpeechRecognition = FakeSpeechRecognition;
  window.__kikoeSpeech = control;
})();
