import AVFoundation
import Speech

/// iOS 26 SpeechAnalyzer with either DictationTranscriber (the SFSpeech
/// dictation model behind the new API) or SpeechTranscriber (Apple's new
/// long-form model). Both take an AnalysisContext whose contextualStrings can
/// be changed mid-session with setContext — no request swap per card — and
/// both can report ranked alternative transcriptions.
@available(iOS 26, *)
@MainActor
final class AnalyzerSpeechEngine: SpeechEngine {
    var onEvent: ((SpeechEvent) -> Void)?

    private let mic: MicCapture
    private let useDictation: Bool
    private var analyzer: SpeechAnalyzer?
    private var input: AsyncStream<AnalyzerInput>.Continuation?
    private var resultsTask: Task<Void, Never>?
    private var converter: AVAudioConverter?
    private var targetFormat: AVAudioFormat?
    private var locale: String?
    private var hints: [String] = []
    private var generation = 0
    /// Audio time (seconds since the analyzer started) fed so far, and the
    /// point reset() cut the stream at: results starting before the cut
    /// belong to an ended utterance and are dropped.
    private var fedSeconds: Double = 0
    private var cutoffSeconds: Double = 0
    /// Both transcribers finalize in short segments (fastResults /
    /// frequentFinalization), so one word can arrive as two finals: まちが
    /// then い. A finished segment is held here and the next one's text is
    /// appended to it; the joined utterance goes to the page as final only
    /// once no more speech follows (see utteranceGap).
    private var utterance: (transcripts: [String], start: Double)?
    private var flushTask: Task<Void, Never>?
    private static let utteranceGap: Duration = .milliseconds(600)
    /// Speech that started but never finalized shouldn't hold the utterance forever.
    private static let volatileTimeout: Duration = .seconds(2)

    init(mic: MicCapture, useDictation: Bool) {
        self.mic = mic
        self.useDictation = useDictation
    }

    func start(locale: String, hints: [String]) {
        self.hints = hints
        if analyzer != nil, locale == self.locale {
            Task { await applyContext() }
            return
        }
        self.locale = locale
        generation += 1
        let gen = generation
        teardown()
        Task {
            do {
                try await build(locale: locale, generation: gen)
            } catch {
                NSLog("[kikoe] analyzer start failed: \(error)")
                if gen == generation { onEvent?(.error("language-not-supported")) }
            }
        }
    }

    func updateHints(_ hints: [String]) {
        guard hints != self.hints else { return }
        self.hints = hints
        Task { await applyContext() }
    }

    func reset() {
        dropUtterance()
        guard let analyzer else { return }
        cutoffSeconds = fedSeconds
        // Close the current segment so speech after the cut starts a new
        // result instead of extending the dropped one.
        Task {
            do { try await analyzer.finalize(through: nil) } catch { NSLog("[kikoe] finalize failed: \(error)") }
        }
    }

    func stop() {
        generation += 1
        locale = nil
        teardown()
        mic.stop()
    }

    private func teardown() {
        dropUtterance()
        input?.finish()
        input = nil
        resultsTask?.cancel()
        resultsTask = nil
        if let analyzer { Task { await analyzer.cancelAndFinishNow() } }
        analyzer = nil
    }

    private func applyContext() async {
        guard let analyzer else { return }
        let ctx = AnalysisContext()
        ctx.contextualStrings[.general] = hints
        do { try await analyzer.setContext(ctx) } catch { NSLog("[kikoe] setContext failed: \(error)") }
    }

    private func makeModule(locale: Locale) -> any SpeechModule {
        if useDictation {
            return DictationTranscriber(locale: locale, contentHints: [.shortForm], transcriptionOptions: [],
                                        reportingOptions: [.volatileResults, .alternativeTranscriptions, .frequentFinalization],
                                        attributeOptions: [])
        }
        return SpeechTranscriber(locale: locale, transcriptionOptions: [],
                                 reportingOptions: [.volatileResults, .alternativeTranscriptions, .fastResults],
                                 attributeOptions: [])
    }

    private func prepare(_ module: any SpeechModule, locale: Locale) async throws {
        let supported = useDictation ? await DictationTranscriber.supportedLocales : await SpeechTranscriber.supportedLocales
        let installed = useDictation ? await DictationTranscriber.installedLocales : await SpeechTranscriber.installedLocales
        let id = locale.identifier(.bcp47)
        NSLog("[kikoe] \(useDictation ? "Dictation" : "Speech")Transcriber \(id): supported=\(supported.contains { $0.identifier(.bcp47) == id }) installed=\(installed.contains { $0.identifier(.bcp47) == id }) available=\(SpeechTranscriber.isAvailable)")
        // Assets are per-locale and must be reserved before they can be
        // checked or downloaded ("not subscribed to transcription.<locale>").
        if !(await AssetInventory.reservedLocales).contains(where: { $0.identifier(.bcp47) == id }) {
            _ = try? await AssetInventory.reserve(locale: locale)
        }
        let status = await AssetInventory.status(forModules: [module])
        NSLog("[kikoe] asset status \(status)")
        if let req = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
            NSLog("[kikoe] downloading assets…")
            try await req.downloadAndInstall()
            NSLog("[kikoe] assets installed")
        }
    }

    private func build(locale: String, generation gen: Int) async throws {
        let module = makeModule(locale: Locale(identifier: locale))
        try await prepare(module, locale: Locale(identifier: locale))
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) else {
            throw NSError(domain: "kikoe", code: 1, userInfo: [NSLocalizedDescriptionKey: "no audio format"])
        }
        guard gen == generation else { return }
        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        let analyzer = SpeechAnalyzer(modules: [module])
        self.analyzer = analyzer
        self.input = continuation
        self.targetFormat = format
        self.converter = nil
        self.fedSeconds = 0
        self.cutoffSeconds = 0
        await applyContext()

        resultsTask = Task { [weak self] in
            do {
                for try await (text, alternatives, isFinal, start) in Self.results(of: module) {
                    guard let self, gen == self.generation else { return }
                    if start < self.cutoffSeconds { continue }
                    self.receive([text] + alternatives, isFinal: isFinal, start: start, generation: gen)
                }
            } catch {
                NSLog("[kikoe] analyzer results ended: \(error)")
            }
        }

        do {
            try mic.start { [weak self] buffer in self?.feed(buffer) }
        } catch {
            onEvent?(.error("audio-capture"))
            return
        }
        try await analyzer.start(inputSequence: stream)
    }

    /// Joins this segment onto any held one and reports it as an interim;
    /// a finished segment is held until utteranceGap passes with no more speech.
    private func receive(_ texts: [String], isFinal: Bool, start: Double, generation gen: Int) {
        let segment = dedupe(texts)
        guard !segment.isEmpty else { return }
        // Each finished segment ends in its own 。 or full stop; drop it
        // where the next segment joins on.
        let separator = (locale ?? "").hasPrefix("ja") ? "" : " "
        let prefix = utterance?.transcripts.first.map {
            String($0.reversed().drop { ".,!?;:。、！？".contains($0) }.reversed()) + separator
        } ?? ""
        let transcripts = dedupe(segment.map { prefix + $0 })
        let id = utterance?.start ?? start
        onEvent?(.result(transcripts: transcripts, isFinal: false, resultId: "analyzer:\(gen):\(id)"))

        flushTask?.cancel()
        if isFinal { utterance = (transcripts, id) }
        guard utterance != nil else { return }
        let wait = isFinal ? Self.utteranceGap : Self.volatileTimeout
        flushTask = Task { [weak self] in
            try? await Task.sleep(for: wait)
            guard !Task.isCancelled, let self, gen == self.generation, let held = self.utterance else { return }
            self.utterance = nil
            self.onEvent?(.result(transcripts: held.transcripts, isFinal: true, resultId: "analyzer:\(gen):\(held.start)"))
        }
    }

    private func dropUtterance() {
        flushTask?.cancel()
        flushTask = nil
        utterance = nil
    }

    private func feed(_ buffer: AVAudioPCMBuffer) {
        guard let input, let targetFormat, let converted = convert(buffer, to: targetFormat) else { return }
        fedSeconds += Double(converted.frameLength) / targetFormat.sampleRate
        input.yield(AnalyzerInput(buffer: converted))
    }

    private func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
        if buffer.format == format { return buffer }
        if converter == nil || converter?.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: format)
        }
        guard let converter else { return nil }
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        var consumed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if consumed { status.pointee = .noDataNow; return nil }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        return error == nil ? out : nil
    }

    /// Flattens the two transcribers' (differently typed) result streams.
    private static func results(of module: any SpeechModule)
        -> AsyncThrowingStream<(String, [String], Bool, Double), Error> {
        AsyncThrowingStream { cont in
            let task = Task {
                do {
                    if let m = module as? DictationTranscriber {
                        for try await r in m.results {
                            cont.yield((String(r.text.characters), r.alternatives.map { String($0.characters) },
                                        r.isFinal, r.range.start.seconds))
                        }
                    } else if let m = module as? SpeechTranscriber {
                        for try await r in m.results {
                            cont.yield((String(r.text.characters), r.alternatives.map { String($0.characters) },
                                        r.isFinal, r.range.start.seconds))
                        }
                    }
                    cont.finish()
                } catch {
                    cont.finish(throwing: error)
                }
            }
            cont.onTermination = { _ in task.cancel() }
        }
    }

    func transcribe(buffers: [AVAudioPCMBuffer], locale: String, hints: [String]) async throws -> [String] {
        let module = makeModule(locale: Locale(identifier: locale))
        try await prepare(module, locale: Locale(identifier: locale))
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) else { return [] }
        NSLog("[kikoe] analyzer format \(format)")
        let analyzer = SpeechAnalyzer(modules: [module])
        let ctx = AnalysisContext()
        ctx.contextualStrings[.general] = hints
        try await analyzer.setContext(ctx)
        let collector = Task { () -> [String] in
            var finals: [(String, [String])] = []
            for try await (text, alts, isFinal, _) in Self.results(of: module) {
                NSLog("[kikoe] analyzer result final=\(isFinal) \(text) \(alts)")
                if isFinal { finals.append((text, alts)) }
            }
            // A single short word should be a single final; if the model split
            // it, join the segments for the top pick.
            guard let first = finals.first else { return [] }
            if finals.count == 1 { return dedupe([first.0] + first.1) }
            return dedupe([finals.map(\.0).joined()] + first.1)
        }
        let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
        converter = nil
        var frames: AVAudioFrameCount = 0
        for b in buffers {
            if let c = convert(b, to: format) { frames += c.frameLength; cont.yield(AnalyzerInput(buffer: c)) }
        }
        NSLog("[kikoe] fed \(frames) frames")
        cont.finish()
        try await analyzer.start(inputSequence: stream)
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        return try await collector.value
    }
}
