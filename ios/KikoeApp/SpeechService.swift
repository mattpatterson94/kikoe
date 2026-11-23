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

    /// The recognizer chosen for each site; the page in charge picks which
    /// one runs (see defaultEngine).
    @Published private(set) var engineKinds: [Site: EngineKind]
    /// The site of the page that last sent "start".
    private var activeSite: Site
    /// The site the running engine was made for; Automatic differs by site.
    private var runningSite: Site
    /// A/B switch: when off, card answers aren't passed to the recognizer as
    /// contextual strings, which behaves like plain Web Speech.
    @Published var sendHints: Bool {
        didSet {
            UserDefaults.standard.set(sendHints, forKey: Pref.sendHints)
            currentHints = effectiveHints
            engine.updateHints(effectiveHints)
        }
    }
    @Published var noiseReduction: Bool {
        didSet {
            guard oldValue != noiseReduction else { return }
            UserDefaults.standard.set(noiseReduction, forKey: Pref.noiseReduction)
            mic.voiceProcessing = noiseReduction
            // Voice processing can only change with the mic stopped.
            swapEngine(to: runningKind)
        }
    }
    /// Run DictationTranscriber alongside SpeechTranscriber on Japanese
    /// cards and add its alternatives (see AnalyzerSpeechEngine).
    @Published var dictationAssist: Bool {
        didSet {
            guard oldValue != dictationAssist else { return }
            UserDefaults.standard.set(dictationAssist, forKey: Pref.dictationAssist)
            swapEngine(to: runningKind)
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
    #if targetEnvironment(macCatalyst)
    private var awakeActivity: NSObjectProtocol?
    #endif
    private var pageHints: [String] = []

    /// Automatic on iOS 26 (see automaticUsesDictation for what it picks).
    static func defaultEngine(for site: Site) -> EngineKind {
        guard #available(iOS 26, *) else { return .legacy }
        return .automatic
    }

    func engineKind(for site: Site) -> EngineKind {
        engineKinds[site] ?? Self.defaultEngine(for: site)
    }

    /// Whether Japanese cards on `site` run SpeechTranscriber, which is when
    /// Dictation assist applies.
    func usesTranscriberForJapanese(_ site: Site) -> Bool {
        switch engineKind(for: site) {
        case .transcriber: true
        case .automatic: !automaticUsesDictation(site: site, locale: SpeechLanguage.japanese)
        default: false
        }
    }

    func setEngineKind(_ kind: EngineKind, for site: Site) {
        guard engineKind(for: site) != kind else { return }
        engineKinds[site] = kind
        UserDefaults.standard.set(kind.rawValue, forKey: Pref.engine(site))
        guard site == activeSite else { return }
        fallbackReason = nil
        swapEngine(to: kind)
    }

    /// The engine the page in charge asked for (runningKind differs only
    /// while falling back).
    private var engineKind: EngineKind { engineKind(for: activeSite) }

    private init() {
        var kinds: [Site: EngineKind] = [:]
        for site in Site.allCases {
            let stored = UserDefaults.standard.string(forKey: Pref.engine(site)).flatMap(EngineKind.init(rawValue:))
            kinds[site] = stored ?? Self.defaultEngine(for: site)
        }
        engineKinds = kinds
        // Start on the engine the site the app reopens on will want, so the
        // first "start" doesn't have to swap it.
        let site = UserDefaults.standard.string(forKey: Pref.lastSite).flatMap(Site.init(rawValue:)) ?? .wanikani
        activeSite = site
        let kind = kinds[site] ?? Self.defaultEngine(for: site)
        runningKind = kind
        runningSite = site
        sendHints = UserDefaults.standard.object(forKey: Pref.sendHints) as? Bool ?? true
        let reduceNoise = UserDefaults.standard.object(forKey: Pref.noiseReduction) as? Bool ?? true
        noiseReduction = reduceNoise
        mic.voiceProcessing = reduceNoise
        let assist = UserDefaults.standard.object(forKey: Pref.dictationAssist) as? Bool ?? true
        dictationAssist = assist
        engine = makeEngine(kind, site: site, mic: mic, dictationAssist: assist)
        engine.onEvent = { [weak self] in self?.deliver($0) }
    }

    func handle(_ body: [String: Any], from session: PageSession) {
        guard let type = body["type"] as? String else { return }
        if type == "start" {
            owner = session
            if session.site != activeSite {
                activeSite = session.site
                if runningKind != engineKind || (engineKind == .automatic && runningSite != activeSite) {
                    fallbackReason = nil
                    // start() below starts the new engine.
                    swapEngine(to: engineKind, restart: false)
                }
            }
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
        let hold = listening && keepAwake
        #if targetEnvironment(macCatalyst)
        // Catalyst ignores isIdleTimerDisabled; a process activity keeps the
        // display (and so the review) from sleeping instead.
        if hold, awakeActivity == nil {
            awakeActivity = ProcessInfo.processInfo.beginActivity(
                options: [.idleDisplaySleepDisabled, .userInitiated], reason: "Kikoe review in progress")
        } else if !hold, let activity = awakeActivity {
            ProcessInfo.processInfo.endActivity(activity)
            awakeActivity = nil
        }
        #else
        UIApplication.shared.isIdleTimerDisabled = hold
        #endif
    }

    private func swapEngine(to kind: EngineKind, restart: Bool = true) {
        let wasListening = listening && restart
        engine.shutdown()
        engine = makeEngine(kind, site: activeSite, mic: mic, dictationAssist: dictationAssist)
        runningKind = kind
        runningSite = activeSite
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
                fallbackReason = "\(runningKind == .automatic ? "The iOS 26 recognizer" : runningKind.rawValue) isn't available for \(currentLocale) on this device, so Kikoe is using SFSpeechRecognizer."
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
