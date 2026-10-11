import AVFoundation
import Speech

/// SFSpeechRecognizer (iOS 10+). This is the engine Safari's own
/// webkitSpeechRecognition sits on, so "legacy without hints" is the closest
/// native stand-in for the extension's current behaviour; the difference the
/// spike measures is `contextualStrings` + on-device + every alternative.
///
/// SFSpeech has no notion of separate utterances inside one task — the
/// transcript just keeps growing ("かい けい どう"). Web Speech's continuous
/// mode hands app.ts one result per utterance, so this engine segments by
/// silence: once partials stop changing for `settleInterval`, it ends the
/// current request (its final result follows) and immediately opens the next
/// one on the same live mic tap.
@MainActor
final class LegacySpeechEngine: SpeechEngine {
    var onEvent: ((SpeechEvent) -> Void)?

    private let mic: MicCapture
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var locale = "ja-JP"
    private var hints: [String] = []
    private var generation = 0
    /// Requests older than this were ended by reset(); their late results are
    /// dropped rather than delivered.
    private var firstLiveGeneration = 0
    private var running = false
    private var settleTimer: Timer?
    private let settleInterval: TimeInterval = 0.8
    /// Set when the on-device model claims support but fails to load
    /// (kLSRErrorDomain 300 — seen in the Simulator once SpeechAnalyzer had
    /// reserved the ja-JP locale); later requests fall back to the server.
    private var onDeviceBroken = false
    private var useOnDevice: Bool { !onDeviceBroken && recognizer?.supportsOnDeviceRecognition == true }

    init(mic: MicCapture) { self.mic = mic }

    func start(locale: String, hints: [String]) {
        self.hints = hints
        if locale != self.locale || recognizer == nil {
            self.locale = locale
            recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale))
        }
        running = true
        do {
            try mic.start { [weak self] buffer in self?.request?.append(buffer) }
        } catch {
            NSLog("[kikoe] mic start failed: \(error)")
            onEvent?(.error("audio-capture"))
            running = false
            return
        }
        // Cancel rather than finish: audio buffered so far belongs to the card
        // being left behind (same reasoning as abort() in recognition.ts).
        task?.cancel()
        beginRequest()
    }

    func updateHints(_ hints: [String]) {
        guard hints != self.hints else { return }
        self.hints = hints
        // contextualStrings are fixed per request, so a mid-card change means
        // a fresh request. The tap keeps running, so no audio route churn.
        guard running else { return }
        task?.cancel()
        beginRequest()
    }

    func reset() {
        guard running else { return }
        settleTimer?.invalidate()
        task?.cancel()
        firstLiveGeneration = generation + 1
        beginRequest()
    }

    func stop() {
        running = false
        settleTimer?.invalidate()
        task?.cancel()
        task = nil
        request = nil
        mic.stop()
    }

    private func makeRequest() -> SFSpeechAudioBufferRecognitionRequest {
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.contextualStrings = hints
        req.addsPunctuation = false
        req.taskHint = .search
        req.requiresOnDeviceRecognition = useOnDevice
        return req
    }

    private func beginRequest() {
        guard running, let recognizer else { return }
        guard recognizer.isAvailable else {
            onEvent?(.error("network"))
            return
        }
        generation += 1
        let gen = generation
        let req = makeRequest()
        request = req
        var lastText = ""
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                guard let self, gen >= self.firstLiveGeneration else { return }
                if let result {
                    let transcripts = dedupe(result.transcriptions.map(\.formattedString))
                    if !transcripts.isEmpty {
                        self.onEvent?(.result(transcripts: transcripts, isFinal: result.isFinal,
                                              resultId: "legacy:\(gen)"))
                    }
                    if !result.isFinal, gen == self.generation, transcripts.first != lastText {
                        lastText = transcripts.first ?? ""
                        self.scheduleSettle(for: gen)
                    }
                    if result.isFinal, gen == self.generation { self.beginRequest() }
                }
                if let error {
                    self.handle(error as NSError, generation: gen)
                }
            }
        }
    }

    private func scheduleSettle(for gen: Int) {
        settleTimer?.invalidate()
        settleTimer = Timer.scheduledTimer(withTimeInterval: settleInterval, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self, gen == self.generation, self.running else { return }
                // End this utterance; its final result arrives via the task
                // callback. Open the next request now so speech that starts
                // during finalisation isn't lost.
                self.request?.endAudio()
                self.beginRequest()
            }
        }
    }

    private func handle(_ error: NSError, generation gen: Int) {
        // Errors from a request we already moved on from are noise.
        guard gen == generation, running else { return }
        NSLog("[kikoe] SFSpeech error \(error.domain) \(error.code): \(error.localizedDescription)")
        switch (error.domain, error.code) {
        case ("kLSRErrorDomain", 300) where !onDeviceBroken:
            onDeviceBroken = true
            beginRequest()
        case ("kAFAssistantErrorDomain", 1110), ("kAFAssistantErrorDomain", 216),
             ("kAFAssistantErrorDomain", 301), ("kLSRErrorDomain", 301):
            // No speech / cancelled — ordinary, just keep listening.
            beginRequest()
        case ("kAFAssistantErrorDomain", 203):
            // Server-side "Empty recognition" (silence) or "Retry"
            // (throttled): not something the page needs to hear about.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self, gen == self.generation else { return }
                self.beginRequest()
            }
        case ("kAFAssistantErrorDomain", 1700):
            onEvent?(.error("not-allowed"))
        default:
            onEvent?(.error("network"))
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                guard let self, gen == self.generation else { return }
                self.beginRequest()
            }
        }
    }

    func transcribe(buffers: [AVAudioPCMBuffer], locale: String, hints: [String]) async throws -> [String] {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) else { return [] }
        self.hints = hints
        self.recognizer = recognizer
        let req = makeRequest()
        req.shouldReportPartialResults = false
        for b in buffers { req.append(b) }
        req.endAudio()
        return try await withCheckedThrowingContinuation { cont in
            var done = false
            recognizer.recognitionTask(with: req) { result, error in
                guard !done else { return }
                if let result, result.isFinal {
                    done = true
                    cont.resume(returning: dedupe(result.transcriptions.map(\.formattedString)))
                } else if let error {
                    done = true
                    let ns = error as NSError
                    if ns.domain == "kLSRErrorDomain", ns.code == 300 { Task { @MainActor in self.onDeviceBroken = true } }
                    if ns.code == 1110 { cont.resume(returning: []) } else { cont.resume(throwing: error) }
                }
            }
        }
    }
}
