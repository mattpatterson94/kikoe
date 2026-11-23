import CoreAudio
import Accelerate
import AVFoundation
import Speech

/// What an engine reports back to the page. Mirrors NativeSpeechEvent in
/// src/native_recognition.ts; error strings use Web Speech's
/// SpeechRecognitionErrorCode vocabulary so app.ts can map them unchanged.
enum SpeechEvent {
    case result(transcripts: [String], isFinal: Bool, resultId: String)
    case error(String)
}

enum EngineKind: String, CaseIterable, Identifiable {
    /// The best of the two iOS 26 models for each site and language (see
    /// automaticUsesDictation).
    case automatic = "Automatic"
    case legacy = "SFSpeechRecognizer"
    case dictation = "DictationTranscriber"
    case transcriber = "SpeechTranscriber"
    var id: String { rawValue }
}

/// One continuous listening session. `start` while already running means
/// "reconfigure" (new locale and/or hints) and drops audio buffered for the
/// previous card; the engine keeps the microphone open across it.
@MainActor
protocol SpeechEngine: AnyObject {
    var onEvent: ((SpeechEvent) -> Void)? { get set }
    func start(locale: String, hints: [String])
    func updateHints(_ hints: [String])
    func stop()
    /// End the utterance in progress and listen afresh with the same locale
    /// and hints. Results still arriving for the ended utterance are dropped,
    /// so the tail of an answer can't land on the next card.
    func reset()
    /// Stop for good and release models (engine swap). Plain stop() may keep
    /// models warm for the next start.
    func shutdown()
    /// Probe path: run pre-recorded buffers through a one-shot session and
    /// return the ranked alternatives of the final result.
    func transcribe(buffers: [AVAudioPCMBuffer], locale: String, hints: [String]) async throws -> [String]
}

extension SpeechEngine {
    func shutdown() { stop() }
}

/// What Automatic runs, from use: on WaniKani, DictationTranscriber for
/// readings (it follows the card's kana hints) and SpeechTranscriber for
/// meanings; on BunPro, SpeechTranscriber throughout, which is better with
/// grammar in context.
func automaticUsesDictation(site: Site, locale: String) -> Bool {
    site == .wanikani && locale.hasPrefix("ja")
}

@MainActor
func makeEngine(_ kind: EngineKind, site: Site, mic: MicCapture, dictationAssist: Bool = false) -> SpeechEngine {
    guard kind != .legacy, #available(iOS 26, *) else { return LegacySpeechEngine(mic: mic) }
    let usesDictation: @MainActor (String) -> Bool
    switch kind {
    case .dictation: usesDictation = { _ in true }
    case .transcriber: usesDictation = { _ in false }
    default: usesDictation = { automaticUsesDictation(site: site, locale: $0) }
    }
    return AnalyzerSpeechEngine(mic: mic, usesDictation: usesDictation, dictationAssist: dictationAssist)
}

/// Called on the realtime audio thread with each captured buffer and its RMS
/// level. Must not block, and must be done with the buffer when it returns
/// (the engine may reuse it).
typealias MicConsumer = @Sendable (AVAudioPCMBuffer, Float) -> Void

/// Owns the audio session and the single AVAudioEngine input tap; engines
/// subscribe to buffers rather than each opening the mic, so swapping
/// recognition requests never tears the audio route down.
///
/// Buffers go to the consumer straight from the audio thread. They used to
/// hop to the main thread first, which is also where the web view and
/// SwiftUI run, so any stall there (a page transition, a redraw) held audio
/// back from the recognizer and it all arrived at once afterwards.
@MainActor
final class MicCapture {
    private let audioEngine = AVAudioEngine()
    private let consumer = LockedValue<MicConsumer?>(nil)
    private(set) var isRunning = false
    /// Apple's voice processing (the FaceTime path): suppresses steady
    /// background noise and cancels echo, so room sound and the page's own
    /// reading audio reach the recognizer less. Applied on the next start.
    var voiceProcessing = true
    /// Live input level for the listening bar's meter.
    let level = MicLevel()

    var inputFormat: AVAudioFormat { audioEngine.inputNode.outputFormat(forBus: 0) }

    func start(consumer: @escaping MicConsumer) throws {
        self.consumer.set(consumer)
        if isRunning { return }
        #if !targetEnvironment(macCatalyst)
        let session = AVAudioSession.sharedInstance()
        // playAndRecord so WaniKani's reading audio still plays while we
        // listen; mixWithOthers keeps the webview's own media from being
        // interrupted. macOS has no audio session; it mixes by default.
        try session.setCategory(.playAndRecord, mode: .default,
                                options: [.defaultToSpeaker, .allowBluetoothHFP, .mixWithOthers])
        try session.setActive(true)
        #endif
        let input = audioEngine.inputNode
        if input.isVoiceProcessingEnabled != voiceProcessing {
            do { try input.setVoiceProcessingEnabled(voiceProcessing) } catch {
                NSLog("[kikoe] voice processing \(voiceProcessing) failed: \(error)")
            }
        }
        if input.isVoiceProcessingEnabled {
            // Voice processing ducks other audio by default; keep the page's
            // reading audio as loud as it allows.
            input.voiceProcessingOtherAudioDuckingConfiguration =
                .init(enableAdvancedDucking: false, duckingLevel: .min)
        }
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        let consumer = self.consumer
        let meter = MeterThrottle(level: level)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            let rms = MicLevel.rms(buffer)
            consumer.get()?(buffer, rms)
            meter.offer(rms)
        }
        audioEngine.prepare()
        try audioEngine.start()
        isRunning = true
    }

    /// Debug: push synthetic audio through the same path as the mic tap.
    func inject(_ buffers: [AVAudioPCMBuffer]) {
        guard isRunning, let consumer = consumer.get() else { return }
        for b in buffers {
            if let converted = AudioConvert.convert(b, to: inputFormat) { consumer(converted, MicLevel.rms(converted)) }
        }
    }

    func stop() {
        consumer.set(nil)
        guard isRunning else { return }
        audioEngine.inputNode.removeTap(onBus: 0)
        audioEngine.stop()
        #if !targetEnvironment(macCatalyst)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
        isRunning = false
        level.value = 0
    }
}

/// A value shared between the audio thread and the main actor.
final class LockedValue<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func get() -> Value { lock.withLock { value } }
    func set(_ newValue: Value) { lock.withLock { value = newValue } }
}

/// Hands the meter the loudest level seen in each 1/15 s. The tap fires ~47
/// times a second, and publishing every one redrew the SwiftUI overlay that
/// often, on the same main thread the web view needs.
private final class MeterThrottle: @unchecked Sendable {
    private static let interval: TimeInterval = 1.0 / 15
    private let lock = NSLock()
    private var peak: Float = 0
    private var last = Date.distantPast
    private weak var level: MicLevel?

    init(level: MicLevel) { self.level = level }

    func offer(_ rms: Float) {
        let send: Float? = lock.withLock {
            peak = max(peak, rms)
            let now = Date()
            guard now.timeIntervalSince(last) >= Self.interval else { return nil }
            last = now
            defer { peak = 0 }
            return peak
        }
        guard let send else { return }
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated { self?.level?.push(send) }
        }
    }
}

/// How loud the microphone is right now, 0...1, smoothed for display: it
/// jumps up with speech and eases back down, like a VU meter. Separate from
/// MicCapture so only the meter redraws, about 15 times a second.
@MainActor
final class MicLevel: ObservableObject {
    @Published var value: Float = 0

    func push(_ rms: Float) {
        // -50 dBFS (a quiet room) to -12 dBFS (speaking close to the phone).
        let db = 20 * log10(max(rms, 1e-6))
        let target = min(max((db + 50) / 38, 0), 1)
        value = target > value ? target : value * 0.55 + target * 0.45
    }

    nonisolated static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var result: Float = 0
        vDSP_rmsqv(samples, 1, &result, vDSP_Length(buffer.frameLength))
        return result
    }
}

enum SpeechPermissions {
    static func request() async -> Bool {
        let speech = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0 == .authorized) }
        }
        let mic = await AVAudioApplication.requestRecordPermission()
        return speech && mic
    }
}

/// Whether a transcript is only punctuation: what SpeechTranscriber emits for
/// a breath, a click or plain silence (`。`, `.`). Never an answer.
func isPunctuationOnly(_ s: String) -> Bool {
    s.unicodeScalars.allSatisfy {
        CharacterSet.punctuationCharacters.contains($0) || CharacterSet.whitespacesAndNewlines.contains($0)
            || CharacterSet.symbols.contains($0)
    }
}

/// Unique, order-preserving list of non-empty transcripts.
func dedupe(_ strings: [String]) -> [String] {
    var seen = Set<String>()
    return strings
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty && seen.insert($0).inserted }
}

enum AudioConvert {
    static func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
        if buffer.format == format { return buffer }
        guard let converter = AVAudioConverter(from: buffer.format, to: format) else { return nil }
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        var consumed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if consumed { status.pointee = .endOfStream; return nil }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        return error == nil ? out : nil
    }
}

/// Renders text with the system voice into PCM buffers, padded with silence
/// so recognizers see a clean utterance boundary.
@MainActor
enum TTS {
    private static let synth = AVSpeechSynthesizer()

    static func render(_ text: String, language: String) async -> [AVAudioPCMBuffer] {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: language)
        return await withCheckedContinuation { cont in
            var buffers: [AVAudioPCMBuffer] = []
            var finished = false
            synth.write(utterance) { buffer in
                guard !finished, let pcm = buffer as? AVAudioPCMBuffer else { return }
                if pcm.frameLength == 0 {
                    finished = true
                    if let fmt = buffers.first?.format {
                        let pad = silence(format: fmt, seconds: 0.5)
                        buffers = pad + buffers + pad + pad
                    }
                    cont.resume(returning: buffers)
                } else {
                    buffers.append(pcm)
                }
            }
        }
    }

    static func silence(format: AVAudioFormat, seconds: Double) -> [AVAudioPCMBuffer] {
        let frames = AVAudioFrameCount(format.sampleRate * seconds)
        guard let b = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return [] }
        b.frameLength = frames
        for buf in UnsafeMutableAudioBufferListPointer(b.mutableAudioBufferList) {
            if let data = buf.mData { memset(data, 0, Int(buf.mDataByteSize)) }
        }
        return [b]
    }
}
