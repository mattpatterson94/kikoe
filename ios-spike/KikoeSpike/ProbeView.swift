import AVFoundation
import SwiftUI

/// Accuracy probe for the short-reading problem described at the top of
/// src/recognition.ts. Each case is spoken by the system TTS voice and run
/// through each engine with and without the card's answers as contextual
/// strings. TTS isn't a human voice, but it's identical across runs, so the
/// *difference* hints make is meaningful; repeat with a real voice on device.
///
/// Launch with `-probe` to run automatically; results are logged and written
/// to Documents/probe.json.
struct ProbeCase: Codable, Hashable {
    let prompt: String   // what the card shows
    let reading: String  // what the user says
}

struct ProbeResult: Codable, Identifiable {
    var id: String { "\(engine)|\(hints)|\(reading)" }
    let engine: String
    let hints: Bool
    let prompt: String
    let reading: String
    let transcripts: [String]
    let top1: Bool
    let anyAlt: Bool
    let error: String?
}

let probeCases: [ProbeCase] = [
    .init(prompt: "会", reading: "かい"), .init(prompt: "計", reading: "けい"),
    .init(prompt: "道", reading: "どう"), .init(prompt: "口", reading: "こう"),
    .init(prompt: "四", reading: "し"), .init(prompt: "木", reading: "き"),
    .init(prompt: "中", reading: "ちゅう"), .init(prompt: "上", reading: "じょう"),
    .init(prompt: "生", reading: "せい"), .init(prompt: "日", reading: "にち"),
    .init(prompt: "業", reading: "ぎょう"), .init(prompt: "用", reading: "よう"),
    .init(prompt: "早", reading: "そう"), .init(prompt: "後", reading: "ご"),
    .init(prompt: "火", reading: "か"), .init(prompt: "気", reading: "け"),
    .init(prompt: "下", reading: "げ"), .init(prompt: "数", reading: "すう"),
    .init(prompt: "工", reading: "く"), .init(prompt: "手", reading: "しゅ"),
]

/// A transcript counts if it is the reading (in either kana script) or the
/// prompt kanji itself — app.ts's dictionary transformers turn the latter
/// back into the reading, so either is an answerable result.
func probeMatches(_ transcript: String, _ c: ProbeCase) -> Bool {
    let t = transcript.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
    let hira = t.applyingTransform(.hiraganaToKatakana, reverse: true) ?? t
    return hira == c.reading || t == c.prompt
}

@MainActor
final class Probe: ObservableObject {
    @Published var results: [ProbeResult] = []
    @Published var running = false
    @Published var status = ""
    @Published var resultsFile: URL?

    static var resultsURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("probe.json")
    }

    func run(engines: [EngineKind]) async {
        running = true
        defer { running = false }
        results = []
        guard await SpeechPermissions.request() else { status = "speech permission denied"; return }
        let mic = MicCapture()
        var audio: [ProbeCase: [AVAudioPCMBuffer]] = [:]
        for c in probeCases { audio[c] = await TTS.render(c.reading, language: "ja-JP") }
        let only = ProcessInfo.processInfo.environment["PROBE_ENGINES"]?.split(separator: ",").map(String.init)
        for kind in engines where only?.contains(kind.rawValue) ?? true {
            if kind != .legacy, #unavailable(iOS 26) { continue }
            let engine = makeEngine(kind, mic: mic)
            for hints in [false, true] {
                for c in probeCases {
                    status = "\(kind.rawValue) hints=\(hints) \(c.reading)"
                    var transcripts: [String] = []
                    var err: String?
                    // The simulator has no on-device ja-JP model, so SFSpeech goes
                    // to Apple's servers, which throttle rapid-fire requests
                    // with 203 "Retry". Pace and retry.
                    for attempt in 0..<4 {
                        do {
                            err = nil
                            transcripts = try await engine.transcribe(buffers: audio[c] ?? [], locale: "ja-JP",
                                                                      hints: hints ? [c.reading, c.prompt] : [])
                            break
                        } catch {
                            err = String(describing: error)
                            try? await Task.sleep(for: .seconds(1 + attempt * 2))
                        }
                    }
                    try? await Task.sleep(for: .milliseconds(400))
                    let r = ProbeResult(engine: kind.rawValue, hints: hints, prompt: c.prompt, reading: c.reading,
                                        transcripts: transcripts,
                                        top1: transcripts.first.map { probeMatches($0, c) } ?? false,
                                        anyAlt: transcripts.contains { probeMatches($0, c) }, error: err)
                    NSLog("[probe] \(r.engine) hints=\(r.hints) \(r.reading): top1=\(r.top1) any=\(r.anyAlt) \(r.transcripts) \(r.error ?? "")")
                    results.append(r)
                }
            }
        }
        status = summary
        NSLog("[probe] SUMMARY\n\(summary)")
        if let data = try? JSONEncoder().encode(results) {
            try? data.write(to: Self.resultsURL)
            resultsFile = Self.resultsURL
        }
    }

    var summary: String {
        var lines: [String] = []
        for kind in EngineKind.allCases {
            for hints in [false, true] {
                let rs = results.filter { $0.engine == kind.rawValue && $0.hints == hints }
                guard !rs.isEmpty else { continue }
                let errors = rs.filter { $0.error != nil }.count
                lines.append("\(kind.rawValue) hints=\(hints): top1 \(rs.filter(\.top1).count)/\(rs.count), any-alt \(rs.filter(\.anyAlt).count)/\(rs.count)\(errors > 0 ? ", errors \(errors)" : "")")
            }
        }
        return lines.joined(separator: "\n")
    }
}

struct ProbeView: View {
    @StateObject private var probe = Probe()
    @State private var engines: Set<EngineKind> = Set(EngineKind.allCases)

    var body: some View {
        List {
            Section {
                ForEach(EngineKind.allCases) { kind in
                    Toggle(kind.rawValue, isOn: Binding(
                        get: { engines.contains(kind) },
                        set: { if $0 { engines.insert(kind) } else { engines.remove(kind) } }))
                }
                Button(probe.running ? "Running…" : "Run probe") {
                    Task { await probe.run(engines: EngineKind.allCases.filter(engines.contains)) }
                }
                .disabled(probe.running)
                Text(probe.status).font(.footnote.monospaced())
                if let file = probe.resultsFile {
                    ShareLink("Share results (probe.json)", item: file)
                }
            }
            Section("Results") {
                ForEach(probe.results) { r in
                    VStack(alignment: .leading) {
                        Text("\(r.top1 ? "✅" : r.anyAlt ? "🟡" : "❌") \(r.prompt) \(r.reading) — \(r.engine)\(r.hints ? " +hints" : "")")
                        Text(r.error ?? r.transcripts.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle("Recognition probe")
        .task {
            if ProcessInfo.processInfo.arguments.contains("-probe") {
                await probe.run(engines: EngineKind.allCases)
            }
        }
    }
}
