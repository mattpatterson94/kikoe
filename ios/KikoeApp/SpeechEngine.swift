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
    /// Probe path: run pre-recorded buffers through a one-shot session and
    /// return the ranked alternatives of the final result.
    func transcribe(buffers: [AVAudioPCMBuffer], locale: String, hints: [String]) async throws -> [String]
}

@MainActor
func makeEngine(_ kind: EngineKind, mic: MicCapture) -> SpeechEngine {
    switch kind {
    case .legacy:
        return LegacySpeechEngine(mic: mic)
    case .dictation, .transcriber:
        if #available(iOS 26, *) {
            return AnalyzerSpeechEngine(mic: mic, useDictation: kind == .dictation)
        }
        return LegacySpeechEngine(mic: mic)
    }
}

/// Owns the audio session and the single AVAudioEngine input tap; engines
/// subscribe to buffers rather than each opening the mic, so swapping
/// recognition requests never tears the audio route down.
@MainActor
final class MicCapture {
    private let audioEngine = AVAudioEngine()
    private var consumer: ((AVAudioPCMBuffer) -> Void)?
    private(set) var isRunning = false
    /// Live input level for the listening bar's meter.
    let level = MicLevel()

    var inputFormat: AVAudioFormat { audioEngine.inputNode.outputFormat(forBus: 0) }

    func start(consumer: @escaping (AVAudioPCMBuffer) -> Void) throws {
        self.consumer = consumer
        if isRunning { return }
        let session = AVAudioSession.sharedInstance()
        // playAndRecord so WaniKani's reading audio still plays while we
        // listen; mixWithOthers keeps the webview's own media from being
        // interrupted. voiceChat would add echo cancellation (the page's
        // audio being heard as an answer) at the cost of quality — worth
        // trying if self-capture shows up in testing.
        try session.setCategory(.playAndRecord, mode: .default,
                                options: [.defaultToSpeaker, .allowBluetoothHFP, .mixWithOthers])
        try session.setActive(true)
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            // Tap runs on a realtime audio thread; hop to main to keep the
            // consumer handoff simple. Fine for a spike.
            let rms = MicLevel.rms(buffer)
            Task { @MainActor in
                self?.level.push(rms)
                self?.consumer?(buffer)
            }
        }
        audioEngine.prepare()
        try audioEngine.start()
        isRunning = true
    }

    /// Debug: push synthetic audio through the same path as the mic tap.
    func inject(_ buffers: [AVAudioPCMBuffer]) {
        guard isRunning, let consumer else { return }
        for b in buffers {
            if let converted = AudioConvert.convert(b, to: inputFormat) { consumer(converted) }
        }
    }

    func stop() {
        consumer = nil
        guard isRunning else { return }
        audioEngine.inputNode.removeTap(onBus: 0)
        audioEngine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        isRunning = false
        level.value = 0
    }
}

/// How loud the microphone is right now, 0...1, smoothed for display: it
/// jumps up with speech and eases back down, like a VU meter. Separate from
/// MicCapture so only the meter redraws ~45 times a second.
@MainActor
final class MicLevel: ObservableObject {
    @Published var value: Float = 0

    func push(_ rms: Float) {
        // -50 dBFS (a quiet room) to -12 dBFS (speaking close to the phone).
        let db = 20 * log10(max(rms, 1e-6))
        let target = min(max((db + 50) / 38, 0), 1)
        value = target > value ? target : value * 0.82 + target * 0.18
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
