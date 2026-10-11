// Runs the same short-reading probe as ProbeView.swift on macOS 26+, where
// SpeechAnalyzer (unlike in the iOS Simulator) actually works. Audio is the
// system Japanese TTS voice rendered to buffers.
//
//   swiftc -O ios/research/macos-probe.swift -o /tmp/kikoe-probe && /tmp/kikoe-probe
import AVFoundation
import Speech

struct Case { let prompt: String; let reading: String }
let cases: [Case] = [
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

let synth = AVSpeechSynthesizer()
@MainActor func render(_ text: String) async -> [AVAudioPCMBuffer] {
    let u = AVSpeechUtterance(string: text)
    u.voice = AVSpeechSynthesisVoice(language: "ja-JP")
    return await withCheckedContinuation { cont in
        var bufs: [AVAudioPCMBuffer] = []
        var done = false
        synth.write(u) { b in
            guard !done, let p = b as? AVAudioPCMBuffer else { return }
            if p.frameLength == 0 {
                done = true
                if let f = bufs.first?.format, let s = AVAudioPCMBuffer(pcmFormat: f, frameCapacity: AVAudioFrameCount(f.sampleRate / 2)) {
                    s.frameLength = s.frameCapacity
                    for buf in UnsafeMutableAudioBufferListPointer(s.mutableAudioBufferList) { if let d = buf.mData { memset(d, 0, Int(buf.mDataByteSize)) } }
                    bufs = [s] + bufs + [s, s]
                }
                cont.resume(returning: bufs)
            } else { bufs.append(p) }
        }
    }
}

func convert(_ b: AVAudioPCMBuffer, to f: AVAudioFormat) -> AVAudioPCMBuffer? {
    if b.format == f { return b }
    guard let c = AVAudioConverter(from: b.format, to: f),
          let out = AVAudioPCMBuffer(pcmFormat: f, frameCapacity: AVAudioFrameCount(Double(b.frameLength) * f.sampleRate / b.format.sampleRate) + 64) else { return nil }
    var used = false
    var err: NSError?
    c.convert(to: out, error: &err) { _, st in
        if used { st.pointee = .endOfStream; return nil }
        used = true; st.pointee = .haveData; return b
    }
    return err == nil ? out : nil
}

func run(_ module: any SpeechModule, buffers: [AVAudioPCMBuffer], hints: [String]) async throws -> [String] {
    guard let fmt = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) else { throw NSError(domain: "no format", code: 0) }
    let analyzer = SpeechAnalyzer(modules: [module])
    let ctx = AnalysisContext()
    ctx.contextualStrings[.general] = hints
    try await analyzer.setContext(ctx)
    let collect = Task { () -> [String] in
        var finals: [[String]] = []
        if let m = module as? DictationTranscriber {
            for try await r in m.results where r.isFinal { finals.append([String(r.text.characters)] + r.alternatives.map { String($0.characters) }) }
        } else if let m = module as? SpeechTranscriber {
            for try await r in m.results where r.isFinal { finals.append([String(r.text.characters)] + r.alternatives.map { String($0.characters) }) }
        }
        guard let first = finals.first else { return [] }
        let top = finals.map { $0[0] }.joined()
        var seen = Set<String>()
        return ([top] + first.dropFirst()).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && seen.insert($0).inserted }
    }
    let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
    for b in buffers { if let c = convert(b, to: fmt) { cont.yield(AnalyzerInput(buffer: c)) } }
    cont.finish()
    try await analyzer.start(inputSequence: stream)
    try await analyzer.finalizeAndFinishThroughEndOfInput()
    return try await collect.value
}

func matches(_ t: String, _ c: Case) -> Bool {
    let s = t.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
    return (s.applyingTransform(.hiraganaToKatakana, reverse: true) ?? s) == c.reading || s == c.prompt
}

@MainActor func main() async {
    let ja = Locale(identifier: "ja-JP")
    var out: [[String: Any]] = []
    let kinds: [(String, () -> any SpeechModule)] = [
        ("DictationTranscriber", { DictationTranscriber(locale: ja, contentHints: [.shortForm], transcriptionOptions: [], reportingOptions: [.alternativeTranscriptions], attributeOptions: []) }),
        ("SpeechTranscriber", { SpeechTranscriber(locale: ja, transcriptionOptions: [], reportingOptions: [.alternativeTranscriptions], attributeOptions: []) }),
    ]
    print("SpeechTranscriber.isAvailable=\(SpeechTranscriber.isAvailable)")
    print("Speech ja supported:", await SpeechTranscriber.supportedLocales.contains { $0.identifier(.bcp47) == "ja-JP" },
          "Dictation ja supported:", await DictationTranscriber.supportedLocales.contains { $0.identifier(.bcp47) == "ja-JP" })
    _ = try? await AssetInventory.reserve(locale: ja)
    var audio: [String: [AVAudioPCMBuffer]] = [:]
    for c in cases { audio[c.reading] = await render(c.reading) }
    for (name, make) in kinds {
        do {
            if let req = try await AssetInventory.assetInstallationRequest(supporting: [make()]) {
                print("installing \(name) assets…"); try await req.downloadAndInstall()
            }
        } catch { print("\(name) asset error: \(error)"); continue }
        for hints in [false, true] {
            var top = 0, any = 0
            for c in cases {
                do {
                    let ts = try await run(make(), buffers: audio[c.reading]!, hints: hints ? [c.reading, c.prompt] : [])
                    let t1 = ts.first.map { matches($0, c) } ?? false, a = ts.contains { matches($0, c) }
                    if t1 { top += 1 }; if a { any += 1 }
                    print("\(name) hints=\(hints) \(c.reading): top1=\(t1) any=\(a) \(ts)")
                    out.append(["engine": name, "hints": hints, "prompt": c.prompt, "reading": c.reading, "transcripts": ts])
                } catch { print("\(name) hints=\(hints) \(c.reading): ERROR \(error)") }
            }
            print("SUMMARY \(name) hints=\(hints): top1 \(top)/\(cases.count) any-alt \(any)/\(cases.count)")
        }
    }
    if let d = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted]) {
        FileManager.default.createFile(atPath: CommandLine.arguments.dropFirst().first ?? "probe-macos.json", contents: d)
    }
}
await main()
