import AVFoundation
import UIKit

/// The one recognizer every page shares; there is only one microphone.
///
/// The page that last sent "start" owns recognition and is the only one that
/// receives results. stop/reset/hints from any other page are ignored, so a
/// site kept alive in the background can't stop or retarget the one in view.
/// (Background pages pause themselves anyway: their webview leaves the
/// window, the document goes hidden, and app.ts stops listening.)
@MainActor
final class SpeechService: ObservableObject {
    static let shared = SpeechService()

    @Published var engineKind: EngineKind {
        didSet {
            guard oldValue != engineKind else { return }
            UserDefaults.standard.set(engineKind.rawValue, forKey: Pref.engine)
            fallbackReason = nil
            swapEngine(to: engineKind)
        }
    }
    /// A/B switch: when off, card answers aren't passed to the recognizer as
    /// contextual strings, which behaves like plain Web Speech.
    @Published var sendHints: Bool {
        didSet {
            UserDefaults.standard.set(sendHints, forKey: Pref.sendHints)
            currentHints = effectiveHints
            engine.updateHints(effectiveHints)
        }
    }
    @Published private(set) var listening = false
    @Published private(set) var lastHeard: [String] = []
    @Published private(set) var currentHints: [String] = []
    @Published private(set) var currentLocale = ""
    /// Set when the chosen engine can't serve the page's language and the
    /// service fell back to SFSpeechRecognizer for this run.
    @Published private(set) var fallbackReason: String?
    /// The language the page asked for, before any override.
    @Published private(set) var pageLocale = ""
    /// Set from the nav bar menu when the page picked the wrong language for
    /// a card (a meaning heard as Japanese, say). Lasts for that card only:
    /// new hints or a new language from the page mean the card changed.
    @Published private(set) var languageOverride: String?

    let mic = MicCapture()
    private(set) var engine: SpeechEngine
    @Published private(set) var runningKind: EngineKind
    private weak var owner: PageSession?
    private var permissionsGranted = false
    private var pageHints: [String] = []

    /// SpeechTranscriber where the OS has it: on the macOS 27 probe it had
    /// the best top-1 accuracy of the three engines by a wide margin. Hints
    /// barely move it, but app.ts's own matching covers what they'd add.
    static var defaultEngine: EngineKind {
        if #available(iOS 26, *) { return .transcriber }
        return .legacy
    }

    private init() {
        let stored = UserDefaults.standard.string(forKey: Pref.engine).flatMap(EngineKind.init(rawValue:))
        let kind = stored ?? Self.defaultEngine
        engineKind = kind
        runningKind = kind
        sendHints = UserDefaults.standard.object(forKey: Pref.sendHints) as? Bool ?? true
        engine = makeEngine(kind, mic: mic)
        engine.onEvent = { [weak self] in self?.deliver($0) }
    }

    func handle(_ body: [String: Any], from session: PageSession) {
        guard let type = body["type"] as? String else { return }
        if type == "start" {
            owner = session
            let lang = body["lang"] as? String ?? "ja-JP"
            let hints = body["hints"] as? [String] ?? []
            if lang != pageLocale || hints != pageHints { languageOverride = nil }
            pageLocale = lang
            pageHints = hints
            Task { await start(lang: languageOverride ?? lang) }
            return
        }
        guard session === owner else { return }
        switch type {
        case "hints":
            pageHints = body["hints"] as? [String] ?? []
            if languageOverride != nil {
                languageOverride = nil
                relisten(in: pageLocale)
            } else {
                currentHints = effectiveHints
                engine.updateHints(effectiveHints)
            }
        case "stop":
            stop()
        case "reset":
            engine.reset()
        default:
            break
        }
    }

    /// A page is going away (closed, reloaded, or its process died).
    func release(_ session: PageSession) {
        if session === owner { stop() }
    }

    /// The page's hints are answers in the page's language, so they'd only
    /// mislead a recognizer switched to the other one.
    private var effectiveHints: [String] { sendHints && languageOverride == nil ? pageHints : [] }

    /// Listen in `lang` for the rest of this card; nil goes back to the
    /// page's choice.
    func overrideLanguage(_ lang: String?) {
        languageOverride = lang == pageLocale ? nil : lang
        relisten(in: languageOverride ?? pageLocale)
    }

    private func relisten(in lang: String) {
        guard listening, !lang.isEmpty else { return }
        currentLocale = lang
        currentHints = effectiveHints
        // A start while running reconfigures without closing the mic.
        engine.start(locale: lang, hints: effectiveHints)
    }

    private func start(lang: String) async {
        if !permissionsGranted {
            permissionsGranted = await SpeechPermissions.request()
            if !permissionsGranted {
                deliver(.error("not-allowed"))
                return
            }
        }
        if lang != currentLocale, fallbackReason != nil, runningKind != engineKind {
            // A fallback was for one language; give the chosen engine
            // another go on the next.
            fallbackReason = nil
            swapEngine(to: engineKind, restart: false)
        }
        currentLocale = lang
        currentHints = effectiveHints
        engine.start(locale: lang, hints: effectiveHints)
        listening = true
        updateIdleTimer()
    }

    func stop() {
        engine.stop()
        listening = false
        updateIdleTimer()
    }

    /// The screen must not lock mid-review; this stands in for the Wake Lock
    /// API and honours the same keep_screen_awake setting.
    func updateIdleTimer() {
        let keepAwake = ExtensionStorage.value("keep_screen_awake") as? Bool ?? true
        UIApplication.shared.isIdleTimerDisabled = listening && keepAwake
    }

    private func swapEngine(to kind: EngineKind, restart: Bool = true) {
        let wasListening = listening && restart
        engine.stop()
        engine = makeEngine(kind, mic: mic)
        runningKind = kind
        engine.onEvent = { [weak self] in self?.deliver($0) }
        if wasListening { engine.start(locale: currentLocale, hints: effectiveHints) }
    }

    private func deliver(_ event: SpeechEvent) {
        let payload: [String: Any]
        switch event {
        case let .result(transcripts, isFinal, resultId):
            if isFinal { lastHeard = transcripts }
            payload = ["type": "result", "transcripts": transcripts, "isFinal": isFinal, "resultId": resultId]
        case let .error(code):
            if code == "language-not-supported", runningKind != .legacy {
                fallbackReason = "\(runningKind.rawValue) isn't available for \(currentLocale) on this device, so Kikoe is using SFSpeechRecognizer."
                NSLog("[kikoe] \(fallbackReason ?? "")")
                swapEngine(to: .legacy)
                return
            }
            payload = ["type": "error", "error": code]
        }
        owner?.deliverSpeech(payload)
    }

    /// Developer: speak `text` with the system voice and feed it into the
    /// live recognizer as if it came from the microphone.
    func injectSpeech(_ text: String) async {
        let lang = currentLocale.isEmpty ? "ja-JP" : currentLocale
        let buffers = await TTS.render(text, language: lang)
        mic.inject(buffers)
    }
}
