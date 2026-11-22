import AVFoundation
import Speech

/// iOS 26 SpeechAnalyzer with either DictationTranscriber (the SFSpeech
/// dictation model behind the new API) or SpeechTranscriber (Apple's new
/// long-form model). Both take an AnalysisContext whose contextualStrings can
/// be changed mid-session with setContext — no request swap per card — and
/// both can report ranked alternative transcriptions.
///
/// Latency comes from three places, each handled here:
///
/// - **Model start-up.** WaniKani alternates meaning (en-US) and reading
///   (ja-JP) cards, and each language needs its own analyzer. Building one
///   (asset check, format lookup, model load) used to happen on nearly every
///   card, and speech during the rebuild was lost. Now each language keeps a
///   warm `Pipeline`; switching card only changes which one the mic feeds.
/// - **Finalization.** SpeechTranscriber is a long-form model: left alone it
///   runs separate answers together (上会) and finalizes seconds after the
///   speech ends. An energy endpointer (`EndpointDetector`) calls
///   `finalize(through:)` after a short silence instead, which on the macOS
///   probe brought finals in within ~30 ms of the call, with up to five
///   alternatives where a volatile result has one.
/// - **The main thread.** Audio is converted and fed from the audio thread
///   (`AudioFeed`), not via the main actor, so a busy web view can't hold it.
///
/// On Japanese, SpeechTranscriber can be paired with DictationTranscriber in
/// the same analyzer (`dictationAssist`). Dictation is less accurate on its
/// own, but it follows the card's kana hints and is a little quicker, so its
/// alternatives are appended to SpeechTranscriber's. On the probe's 20 short
/// on'yomi, strict-mode matches went from 14 to 16.
@available(iOS 26, *)
@MainActor
final class AnalyzerSpeechEngine: SpeechEngine {
    var onEvent: ((SpeechEvent) -> Void)?

    private let mic: MicCapture
    /// Per locale: DictationTranscriber (true) or SpeechTranscriber. Each
    /// language has its own pipeline, so Automatic can mix them without
    /// rebuilding anything when the card's language changes.
    private let usesDictation: @MainActor (String) -> Bool
    private let dictationAssist: Bool
    /// The feed the mic tap writes to: the active pipeline's, or nil.
    private let route = LockedValue<AudioFeed?>(nil)
    private var pipelines: [String: Pipeline] = [:]
    private var building: [String: Task<Pipeline?, Never>] = [:]
    private var active: Pipeline?
    /// The locale the page wants, whether or not its pipeline is ready yet.
    private var locale: String?
    private var hints: [String] = []
    private var running = false
    /// Bumped whenever results in flight should be ignored (switch, stop).
    private var generation = 0

    /// Both transcribers finalize in short segments, so one word can arrive
    /// as two finals: まちが then い. A finished segment is held here and the
    /// next one's text is appended to it; the joined utterance goes to the
    /// page as final only once no more speech follows (see utteranceGap).
    private var primary = Segments()
    private var helper = Segments()
    private var utteranceId: Double?
    private var flushTask: Task<Void, Never>?
    /// Audio time (on the active pipeline's clock) up to which results have
    /// been delivered or discarded; anything ending before it is stale.
    private var consumedThrough: Double = 0
    private static let utteranceGap: Duration = .milliseconds(600)
    /// Speech that started but never finalized shouldn't hold the utterance forever.
    private static let volatileTimeout: Duration = .seconds(2)

    init(mic: MicCapture, usesDictation: @escaping @MainActor (String) -> Bool, dictationAssist: Bool = false) {
        self.mic = mic
        self.usesDictation = usesDictation
        self.dictationAssist = dictationAssist
    }

    // MARK: - SpeechEngine

    func start(locale: String, hints: [String]) {
        self.hints = hints
        running = true
        let route = self.route
        do {
            try mic.start { buffer, rms in route.get()?.ingest(buffer, rms: rms) }
        } catch {
            NSLog("[kikoe] mic start failed: \(error)")
            onEvent?(.error("audio-capture"))
            running = false
            return
        }
        if let active, active.locale == locale, active.alive {
            // Same language: a start is a reconfigure (new hints). A pause
            // already cut the audio before it.
            applyContext(active)
            return
        }
        switchTo(locale)
    }

    func updateHints(_ hints: [String]) {
        guard hints != self.hints else { return }
        self.hints = hints
        if let active { applyContext(active) }
    }

    func reset() {
        guard let active else { return }
        cut(active)
    }

    func stop() {
        running = false
        generation += 1
        if let active { cut(active) }
        active = nil
        locale = nil
        route.set(nil)
        mic.stop()
    }

    func shutdown() {
        stop()
        for task in building.values { task.cancel() }
        building = [:]
        for p in pipelines.values { p.close() }
        pipelines = [:]
    }

    // MARK: - Pipelines

    private func switchTo(_ locale: String) {
        generation += 1
        dropUtterance()
        if let old = active { cut(old) }
        active = nil
        route.set(nil)
        self.locale = locale
        if let ready = pipelines[locale], ready.alive {
            activate(ready)
            return
        }
        let gen = generation
        Task {
            guard let p = await pipeline(for: locale) else {
                if gen == generation { onEvent?(.error("language-not-supported")) }
                return
            }
            // The page may have moved on (or stopped) while this built.
            guard running, self.locale == locale, active == nil else { return }
            activate(p)
        }
    }

    private func activate(_ p: Pipeline) {
        active = p
        p.feed.resetEndpointing()
        consumedThrough = p.feed.fedSeconds
        p.cutoff = consumedThrough
        applyContext(p)
        route.set(p.feed)
        prewarmCounterpart(of: p.locale)
    }

    /// WaniKani alternates languages card by card, so build the other one in
    /// the background once the first is listening.
    private func prewarmCounterpart(of locale: String) {
        let other: String
        if locale.hasPrefix("ja") { other = "en-US" } else if locale.hasPrefix("en") { other = "ja-JP" } else { return }
        guard pipelines[other]?.alive != true else { return }
        Task { _ = await pipeline(for: other) }
    }

    private func pipeline(for locale: String) async -> Pipeline? {
        if let p = pipelines[locale], p.alive { return p }
        if let task = building[locale] { return await task.value }
        let task = Task { () -> Pipeline? in
            do {
                return try await build(locale: locale)
            } catch {
                NSLog("[kikoe] analyzer start failed for \(locale): \(error)")
                return nil
            }
        }
        building[locale] = task
        let p = await task.value
        building[locale] = nil
        if let p { pipelines[locale] = p }
        return p
    }

    private func build(locale id: String) async throws -> Pipeline {
        let locale = Locale(identifier: id)
        let primaryModule = makeModule(locale: id)
        try await prepare(primaryModule, locale: locale)
        var helperModule: DictationTranscriber?
        if dictationAssist, !usesDictation(id), id.hasPrefix("ja") {
            let m = DictationTranscriber(locale: locale, contentHints: [.shortForm], transcriptionOptions: [],
                                         reportingOptions: [.volatileResults, .alternativeTranscriptions, .frequentFinalization],
                                         attributeOptions: [])
            do {
                try await prepare(m, locale: locale)
                helperModule = m
            } catch {
                NSLog("[kikoe] dictation assist unavailable: \(error)")
            }
        }
        let modules: [any SpeechModule] = [primaryModule] + (helperModule.map { [$0] } ?? [])
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules) else {
            throw NSError(domain: "kikoe", code: 1, userInfo: [NSLocalizedDescriptionKey: "no audio format"])
        }
        let analyzer = SpeechAnalyzer(modules: modules,
                                      options: .init(priority: .userInitiated, modelRetention: .processLifetime))
        // Load the models now rather than on the first word.
        try await analyzer.prepareToAnalyze(in: format)
        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        let feed = AudioFeed(input: continuation, format: format)
        let p = Pipeline(locale: id, analyzer: analyzer, feed: feed)
        feed.onEndpoint = { [weak self, weak p] seconds in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, let p, self.active === p else { return }
                    Task { try? await p.analyzer.finalize(through: CMTime(seconds: seconds, preferredTimescale: 48_000)) }
                }
            }
        }
        p.tasks.append(listen(to: primaryModule, in: p, isHelper: false))
        if let helperModule { p.tasks.append(listen(to: helperModule, in: p, isHelper: true)) }
        try await analyzer.start(inputSequence: stream)
        NSLog("[kikoe] analyzer ready for \(id)\(helperModule == nil ? "" : " with dictation assist")")
        return p
    }

    private func listen(to module: any SpeechModule, in p: Pipeline, isHelper: Bool) -> Task<Void, Never> {
        Task { [weak self] in
            do {
                for try await r in Self.results(of: module) {
                    guard let self, self.active === p else { continue }
                    if r.start < p.cutoff || r.end <= self.consumedThrough { continue }
                    if isHelper {
                        self.receive(r, into: \.helper)
                    } else {
                        self.receive(r, into: \.primary)
                    }
                }
            } catch {
                NSLog("[kikoe] analyzer results ended for \(p.locale): \(error)")
            }
            // A pipeline whose results stopped is no use; rebuild on demand.
            guard let self, p.alive else { return }
            p.close()
            if self.pipelines[p.locale] === p { self.pipelines[p.locale] = nil }
            if self.active === p, self.running, let locale = self.locale {
                self.active = nil
                self.route.set(nil)
                try? await Task.sleep(for: .milliseconds(500))
                if self.running, self.active == nil, self.locale == locale { self.switchTo(locale) }
            }
        }
    }

    /// Drop everything up to now on this pipeline's clock and close the
    /// segment in progress, so speech after the cut starts a new result
    /// instead of extending the dropped one.
    private func cut(_ p: Pipeline) {
        dropUtterance()
        let now = p.feed.fedSeconds
        p.cutoff = now
        consumedThrough = now
        p.feed.resetEndpointing()
        Task {
            do { try await p.analyzer.finalize(through: nil) } catch { NSLog("[kikoe] finalize failed: \(error)") }
        }
    }

    private func applyContext(_ p: Pipeline) {
        let hints = self.hints
        Task {
            let ctx = AnalysisContext()
            ctx.contextualStrings[.general] = hints
            do { try await p.analyzer.setContext(ctx) } catch { NSLog("[kikoe] setContext failed: \(error)") }
        }
    }

    // MARK: - Results

    /// Folds one result into its module's segments and tells the page.
    private func receive(_ r: TranscriberResult, into keyPath: ReferenceWritableKeyPath<AnalyzerSpeechEngine, Segments>) {
        let texts = dedupe([r.text] + r.alternatives).filter { !isPunctuationOnly($0) }
        let separator = (locale ?? "").hasPrefix("ja") ? "" : " "
        guard self[keyPath: keyPath].add(texts, isFinal: r.isFinal, end: r.end, separator: separator) else { return }
        if utteranceId == nil { utteranceId = r.start }
        let transcripts = merged
        guard !transcripts.isEmpty else { return }
        onEvent?(.result(transcripts: transcripts, isFinal: false, resultId: resultId))

        flushTask?.cancel()
        guard primary.hasFinal || helper.hasFinal else { return }
        let wait = r.isFinal ? Self.utteranceGap : Self.volatileTimeout
        let gen = generation
        flushTask = Task { [weak self] in
            try? await Task.sleep(for: wait)
            guard !Task.isCancelled, let self, gen == self.generation else { return }
            self.flush()
        }
    }

    /// SpeechTranscriber's alternatives first (the better model), then
    /// Dictation's.
    private var merged: [String] { dedupe(primary.transcripts + helper.transcripts) }
    private var resultId: String { "analyzer:\(generation):\(utteranceId ?? 0)" }

    private func flush() {
        let transcripts = merged
        let id = resultId
        consumedThrough = max(consumedThrough, primary.end, helper.end)
        dropUtterance()
        guard !transcripts.isEmpty else { return }
        onEvent?(.result(transcripts: transcripts, isFinal: true, resultId: id))
    }

    private func dropUtterance() {
        flushTask?.cancel()
        flushTask = nil
        primary = Segments()
        helper = Segments()
        utteranceId = nil
    }

    // MARK: - Modules

    private func makeModule(locale id: String) -> any SpeechModule {
        let locale = Locale(identifier: id)
        if usesDictation(id) {
            return DictationTranscriber(locale: locale, contentHints: [.shortForm], transcriptionOptions: [],
                                        reportingOptions: [.volatileResults, .alternativeTranscriptions, .frequentFinalization],
                                        attributeOptions: [])
        }
        return SpeechTranscriber(locale: locale, transcriptionOptions: [],
                                 reportingOptions: [.volatileResults, .alternativeTranscriptions, .fastResults],
                                 attributeOptions: [])
    }

    private func prepare(_ module: any SpeechModule, locale: Locale) async throws {
        let isDictation = module is DictationTranscriber
        let supported = isDictation ? await DictationTranscriber.supportedLocales : await SpeechTranscriber.supportedLocales
        let installed = isDictation ? await DictationTranscriber.installedLocales : await SpeechTranscriber.installedLocales
        let id = locale.identifier(.bcp47)
        NSLog("[kikoe] \(isDictation ? "Dictation" : "Speech")Transcriber \(id): supported=\(supported.contains { $0.identifier(.bcp47) == id }) installed=\(installed.contains { $0.identifier(.bcp47) == id }) available=\(SpeechTranscriber.isAvailable)")
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

    /// Flattens the two transcribers' (differently typed) result streams.
    private static func results(of module: any SpeechModule) -> AsyncThrowingStream<TranscriberResult, Error> {
        AsyncThrowingStream { cont in
            let task = Task {
                do {
                    if let m = module as? DictationTranscriber {
                        for try await r in m.results {
                            cont.yield(TranscriberResult(text: String(r.text.characters),
                                                         alternatives: r.alternatives.map { String($0.characters) },
                                                         isFinal: r.isFinal, start: r.range.start.seconds,
                                                         end: r.range.end.seconds))
                        }
                    } else if let m = module as? SpeechTranscriber {
                        for try await r in m.results {
                            cont.yield(TranscriberResult(text: String(r.text.characters),
                                                         alternatives: r.alternatives.map { String($0.characters) },
                                                         isFinal: r.isFinal, start: r.range.start.seconds,
                                                         end: r.range.end.seconds))
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

    // MARK: - Probe

    func transcribe(buffers: [AVAudioPCMBuffer], locale: String, hints: [String]) async throws -> [String] {
        let module = makeModule(locale: locale)
        try await prepare(module, locale: Locale(identifier: locale))
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) else { return [] }
        NSLog("[kikoe] analyzer format \(format)")
        let analyzer = SpeechAnalyzer(modules: [module])
        let ctx = AnalysisContext()
        ctx.contextualStrings[.general] = hints
        try await analyzer.setContext(ctx)
        let collector = Task { () -> [String] in
            var finals: [(String, [String])] = []
            for try await r in Self.results(of: module) {
                NSLog("[kikoe] analyzer result final=\(r.isFinal) \(r.text) \(r.alternatives)")
                if r.isFinal { finals.append((r.text, r.alternatives)) }
            }
            // A single short word should be a single final; if the model split
            // it, join the segments for the top pick.
            guard let first = finals.first else { return [] }
            if finals.count == 1 { return dedupe([first.0] + first.1) }
            return dedupe([finals.map(\.0).joined()] + first.1)
        }
        let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
        var frames: AVAudioFrameCount = 0
        for b in buffers {
            if let c = AudioConvert.convert(b, to: format) { frames += c.frameLength; cont.yield(AnalyzerInput(buffer: c)) }
        }
        NSLog("[kikoe] fed \(frames) frames")
        cont.finish()
        try await analyzer.start(inputSequence: stream)
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        return try await collector.value
    }
}

struct TranscriberResult {
    let text: String
    let alternatives: [String]
    let isFinal: Bool
    let start: Double
    let end: Double
}

/// One module's view of the utterance in progress: the finished segments
/// joined so far, plus the latest (possibly volatile) one on the end.
///
/// The joins keep the alternatives of every segment, not just the top one:
/// SpeechTranscriber hears かい as は (alternatives か, 会) then い。, and
/// only the か + い pairing is the answer.
struct Segments {
    static let maxFinishedAlternatives = 5
    static let maxTranscripts = 10

    /// Ranked joins of the finished segments, trailing punctuation removed.
    private var finished: [String] = []
    private(set) var transcripts: [String] = []
    private(set) var hasFinal = false
    private(set) var end: Double = 0
    /// The segment in progress as last heard, before its final.
    ///
    /// SpeechTranscriber's English finals often lose the word its volatile
    /// result had right: "Water." finalizes as "." or "to.". A
    /// punctuation-only final used to be dropped, leaving the answer waiting
    /// for a final that never came, and "to." was graded as a miss. The
    /// final now keeps these as alternatives after its own.
    private var volatile: [String] = []

    /// Returns false when there was nothing to add.
    @discardableResult
    mutating func add(_ texts: [String], isFinal: Bool, end: Double, separator: String) -> Bool {
        let texts = isFinal ? dedupe(texts + volatile) : texts
        if isFinal { volatile = [] } else if !texts.isEmpty { volatile = texts }
        guard !texts.isEmpty else { return false }
        transcripts = Self.join(finished, texts, separator: separator)
        self.end = max(self.end, end)
        if isFinal, !transcripts.isEmpty {
            hasFinal = true
            // Each finished segment ends in its own 。 or full stop; drop it
            // where the next segment joins on.
            finished = dedupe(transcripts.prefix(Self.maxFinishedAlternatives).map {
                String($0.reversed().drop { ".,!?;:。、！？".contains($0) }.reversed())
            })
        }
        return true
    }

    /// Every prefix × segment pairing, best combined rank first, so the
    /// recognizer's own top pick stays first.
    static func join(_ prefixes: [String], _ texts: [String], separator: String) -> [String] {
        guard !prefixes.isEmpty else { return dedupe(texts) }
        var pairs: [(rank: Int, text: String)] = []
        for (i, p) in prefixes.enumerated() {
            for (j, t) in texts.enumerated() { pairs.append((i + j, p + separator + t)) }
        }
        let ranked = pairs.enumerated().sorted { ($0.element.rank, $0.offset) < ($1.element.rank, $1.offset) }
        return Array(dedupe(ranked.map(\.element.text)).prefix(maxTranscripts))
    }
}

/// One warm analyzer for one language.
@available(iOS 26, *)
@MainActor
final class Pipeline {
    let locale: String
    let analyzer: SpeechAnalyzer
    let feed: AudioFeed
    var tasks: [Task<Void, Never>] = []
    /// Results starting before this (seconds on this analyzer's clock)
    /// belong to an utterance that was cut off.
    var cutoff: Double = 0
    private(set) var alive = true

    init(locale: String, analyzer: SpeechAnalyzer, feed: AudioFeed) {
        self.locale = locale
        self.analyzer = analyzer
        self.feed = feed
    }

    func close() {
        guard alive else { return }
        alive = false
        feed.finish()
        for t in tasks { t.cancel() }
        let analyzer = self.analyzer
        Task { await analyzer.cancelAndFinishNow() }
    }
}

/// What the audio thread touches for one analyzer: format conversion, the
/// input stream, its clock and the endpointer. Everything is behind a lock;
/// the main actor only reads the clock and resets the endpointer.
///
/// The analyzer's clock only advances while this feed is the active one: it
/// counts the audio actually fed, which is what the analyzer's result ranges
/// are measured in.
@available(iOS 26, *)
final class AudioFeed: @unchecked Sendable {
    private let lock = NSLock()
    private let input: AsyncStream<AnalyzerInput>.Continuation
    private let format: AVAudioFormat
    private var converter: AVAudioConverter?
    private var fed: Double = 0
    private var endpointer = EndpointDetector()
    /// Called (on the audio thread) with the clock time an utterance ended.
    var onEndpoint: (@Sendable (Double) -> Void)?

    init(input: AsyncStream<AnalyzerInput>.Continuation, format: AVAudioFormat) {
        self.input = input
        self.format = format
    }

    var fedSeconds: Double { lock.withLock { fed } }

    func resetEndpointing() { lock.withLock { endpointer.reset() } }

    func ingest(_ buffer: AVAudioPCMBuffer, rms: Float) {
        let endpoint: Double? = lock.withLock {
            guard let converted = convert(buffer) else { return nil }
            fed += Double(converted.frameLength) / format.sampleRate
            input.yield(AnalyzerInput(buffer: converted))
            let seconds = Double(buffer.frameLength) / buffer.format.sampleRate
            return endpointer.push(rms: rms, seconds: seconds) ? fed : nil
        }
        if let endpoint { onEndpoint?(endpoint) }
    }

    func finish() { input.finish() }

    /// Streaming conversion: one converter kept across buffers (so the
    /// resampler's state carries over), fed one buffer per call.
    private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        if buffer.format == format {
            // The tap may reuse its buffer once the callback returns.
            return copy(buffer)
        }
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

    private func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let out = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return nil }
        out.frameLength = buffer.frameLength
        let src = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: buffer.audioBufferList))
        let dst = UnsafeMutableAudioBufferListPointer(out.mutableAudioBufferList)
        for (s, d) in zip(src, dst) {
            if let sd = s.mData, let dd = d.mData { memcpy(dd, sd, Int(min(s.mDataByteSize, d.mDataByteSize))) }
        }
        return out
    }
}

/// Decides when the user has stopped talking, from the mic's RMS level.
///
/// Speech is anything well above a running noise floor (which drops at once
/// to the quietest level heard and creeps back up slowly, so it follows a
/// noisy room without mistaking speech for noise). After at least
/// `minSpeech` of speech, `endSilence` of non-speech is an endpoint.
///
/// A missed endpoint (a noisy room that never goes quiet) just leaves the
/// transcriber to finalize on its own, as before. An early one (a pause
/// mid-phrase) splits the utterance into segments, which the engine joins
/// back together.
struct EndpointDetector {
    static let minSpeech = 0.12
    static let endSilence = 0.45
    /// How far above the noise floor counts as speech, and the quietest
    /// level that can count at all.
    static let marginDb: Float = 10
    static let minSpeechDb: Float = -50
    /// How fast the floor rises when the room gets louder, in dB/s.
    static let floorRise: Float = 3

    /// Starts above anything real, so the first buffers set it.
    private var floorDb: Float = 0
    private var speech = 0.0
    private var silence = 0.0

    /// Forget the utterance in progress; the noise floor carries over.
    mutating func reset() {
        speech = 0
        silence = 0
    }

    /// Returns true on the buffer that completes an endpoint.
    mutating func push(rms: Float, seconds: Double) -> Bool {
        let db = 20 * log10(max(rms, 1e-6))
        if db < floorDb {
            floorDb = db
        } else {
            floorDb += Self.floorRise * Float(seconds)
        }
        let isSpeech = db > max(floorDb + Self.marginDb, Self.minSpeechDb)
        if isSpeech {
            speech += seconds
            silence = 0
            return false
        }
        guard speech >= Self.minSpeech else {
            // A click or a breath: let it fade rather than accumulate.
            speech = max(0, speech - seconds)
            return false
        }
        silence += seconds
        guard silence >= Self.endSilence else { return false }
        speech = 0
        silence = 0
        return true
    }
}
