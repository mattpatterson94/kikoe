import AVFoundation
import UIKit
import WebKit

/// Everything the page talks to: the chrome.* shim (kikoeExt), the native
/// recognizer (kikoeSpeech) and log forwarding (kikoeLog).
@MainActor
final class KikoeBridge: NSObject, ObservableObject, WKScriptMessageHandler, WKScriptMessageHandlerWithReply {
    @Published var engineKind: EngineKind = .legacy {
        didSet { if oldValue != engineKind { swapEngine() } }
    }
    /// A/B switch: when off, hints from the page are ignored, which makes the
    /// native path behave like plain Safari Web Speech for comparison.
    @Published var sendHints = true
    @Published var showSettings = false
    @Published private(set) var listening = false
    @Published private(set) var lastHeard: [String] = []
    @Published private(set) var currentHints: [String] = []
    @Published private(set) var currentLocale = ""

    weak var webView: WKWebView?
    let mic = MicCapture()
    private(set) var engine: SpeechEngine
    private var permissionsGranted = false
    private var pageHints: [String] = []

    override init() {
        engine = LegacySpeechEngine(mic: mic)
        super.init()
        engine.onEvent = { [weak self] in self?.deliver($0) }
    }

    // MARK: - User script

    static func userScript() -> WKUserScript? {
        guard let web = Bundle.main.url(forResource: "KikoeWeb", withExtension: nil),
              let shimURL = Bundle.main.url(forResource: "ExtensionShim", withExtension: "js"),
              let shim = try? String(contentsOf: shimURL, encoding: .utf8),
              let content = try? String(contentsOf: web.appendingPathComponent("content.js"), encoding: .utf8)
        else {
            NSLog("[kikoe] KikoeWeb resources missing — run `npm run build` before building the app")
            return nil
        }
        var source = "(function () {\n\(shim)\n"
        for name in ["injected.js", "bundle.js"] {
            guard let js = try? String(contentsOf: web.appendingPathComponent(name), encoding: .utf8) else { continue }
            source += "__kikoeResources['\(name)'] = function () {\n\(js)\n};\n"
        }
        source += "(function (chrome) {\n\(content)\n})(kikoeChrome);\n})();"
        // Matches the manifest's run_at: document_end, top frame only.
        return WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .page)
    }

    func install(into controller: WKUserContentController) {
        if let script = Self.userScript() { controller.addUserScript(script) }
        controller.add(self, contentWorld: .page, name: "kikoeSpeech")
        controller.add(self, contentWorld: .page, name: "kikoeLog")
        controller.addScriptMessageHandler(self, contentWorld: .page, name: "kikoeExt")
    }

    // MARK: - kikoeSpeech / kikoeLog

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "kikoeLog" {
            NSLog("[page] \(message.body)")
            return
        }
        guard message.name == "kikoeSpeech", let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "start":
            let lang = body["lang"] as? String ?? "ja-JP"
            pageHints = body["hints"] as? [String] ?? []
            Task { await start(lang: lang) }
        case "hints":
            pageHints = body["hints"] as? [String] ?? []
            currentHints = effectiveHints
            engine.updateHints(effectiveHints)
        case "stop":
            stopListening()
        default:
            break
        }
    }

    private var effectiveHints: [String] { sendHints ? pageHints : [] }

    private func start(lang: String) async {
        if !permissionsGranted {
            permissionsGranted = await SpeechPermissions.request()
            if !permissionsGranted {
                deliver(.error("not-allowed"))
                return
            }
        }
        currentLocale = lang
        currentHints = effectiveHints
        engine.start(locale: lang, hints: effectiveHints)
        listening = true
        // Scope item 5: the screen must not lock mid-review. This replaces the
        // Wake Lock API path for the native host.
        UIApplication.shared.isIdleTimerDisabled = true
    }

    func stopListening() {
        engine.stop()
        listening = false
        UIApplication.shared.isIdleTimerDisabled = false
    }

    private func swapEngine() {
        let wasListening = listening
        engine.stop()
        engine = makeEngine(engineKind, mic: mic)
        engine.onEvent = { [weak self] in self?.deliver($0) }
        if wasListening { engine.start(locale: currentLocale, hints: effectiveHints) }
    }

    private func deliver(_ event: SpeechEvent) {
        let payload: [String: Any]
        switch event {
        case let .result(transcripts, isFinal, resultId):
            if isFinal { lastHeard = transcripts }
            NSLog("[kikoe] heard \(isFinal ? "final" : "interim"): \(transcripts) hints=\(currentHints)")
            payload = ["type": "result", "transcripts": transcripts, "isFinal": isFinal, "resultId": resultId]
        case let .error(code):
            payload = ["type": "error", "error": code]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript(
            "document.dispatchEvent(new CustomEvent('kikoe:nativeSpeech', { detail: \(json) }));",
            in: nil, in: .page, completionHandler: nil)
    }

    /// Debug: speak `text` with the system TTS voice and feed it into the live
    /// recognizer as if it came from the microphone. Lets the whole
    /// page → native → page loop run in the Simulator without a voice.
    func injectSpeech(_ text: String) async {
        let lang = currentLocale.isEmpty ? "ja-JP" : currentLocale
        let buffers = await TTS.render(text, language: lang)
        mic.inject(buffers)
    }

    // MARK: - kikoeExt (chrome.* shim)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "bad message")
            return
        }
        switch op {
        case "storage.get":
            let area = body["area"] as? String ?? "sync"
            let keys = (body["keys"] as? String).flatMap(Self.parse)
            replyHandler(Self.json(ExtensionStorage.get(area: area, keys: keys)), nil)
        case "storage.set":
            let area = body["area"] as? String ?? "sync"
            let items = (body["items"] as? String).flatMap(Self.parse) as? [String: Any] ?? [:]
            replyHandler(Self.json(ExtensionStorage.set(area: area, items: items)), nil)
        case "storage.remove":
            let area = body["area"] as? String ?? "sync"
            let keys = (body["keys"] as? String).flatMap(Self.parse)
            ExtensionStorage.remove(area: area, keys: keys)
            replyHandler("null", nil)
        case "runtime.sendMessage":
            let msg = (body["message"] as? String).flatMap(Self.parse) as? [String: Any]
            if msg?["type"] as? String == "kikoe:openOptions" { showSettings = true }
            if msg?["type"] as? String == "kikoe:openApiTokenPage" {
                webView?.load(URLRequest(url: URL(string: "https://www.wanikani.com/settings/personal_access_tokens")!))
            }
            replyHandler("null", nil)
        case "resource":
            let path = body["path"] as? String ?? ""
            guard !path.contains(".."),
                  let url = Bundle.main.url(forResource: "KikoeWeb", withExtension: nil)?.appendingPathComponent(path),
                  let text = try? String(contentsOf: url, encoding: .utf8) else {
                replyHandler(nil, "missing \(path)")
                return
            }
            replyHandler(text, nil)
        default:
            replyHandler(nil, "unknown op \(op)")
        }
    }

    private static func parse(_ s: String) -> Any? {
        try? JSONSerialization.jsonObject(with: Data(s.utf8), options: [.fragmentsAllowed])
    }

    private static func json(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else { return "null" }
        return String(data: data, encoding: .utf8) ?? "null"
    }
}

/// chrome.storage.{sync,local} on UserDefaults, one JSON blob per area.
enum ExtensionStorage {
    private static func key(_ area: String) -> String { "kikoe.storage.\(area)" }

    static func all(area: String) -> [String: Any] {
        guard let s = UserDefaults.standard.string(forKey: key(area)),
              let obj = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else { return [:] }
        return obj
    }

    private static func save(_ dict: [String: Any], area: String) {
        if let data = try? JSONSerialization.data(withJSONObject: dict) {
            UserDefaults.standard.set(String(data: data, encoding: .utf8), forKey: key(area))
        }
    }

    /// `keys` follows chrome.storage.get: null (everything), a key, an array
    /// of keys, or an object of key → default.
    static func get(area: String, keys: Any?) -> [String: Any] {
        let stored = all(area: area)
        switch keys {
        case nil, is NSNull:
            return stored
        case let k as String:
            return stored[k].map { [k: $0] } ?? [:]
        case let ks as [String]:
            return stored.filter { ks.contains($0.key) }
        case let defaults as [String: Any]:
            return defaults.merging(stored.filter { defaults.keys.contains($0.key) }) { _, new in new }
        default:
            return [:]
        }
    }

    /// Returns chrome.storage.onChanged-shaped changes.
    static func set(area: String, items: [String: Any]) -> [String: Any] {
        var stored = all(area: area)
        var changes: [String: Any] = [:]
        for (k, v) in items {
            var change: [String: Any] = ["newValue": v]
            if let old = stored[k] { change["oldValue"] = old }
            changes[k] = change
            stored[k] = v
        }
        save(stored, area: area)
        return changes
    }

    static func remove(area: String, keys: Any?) {
        var stored = all(area: area)
        let ks: [String] = (keys as? [String]) ?? ((keys as? String).map { [$0] } ?? [])
        for k in ks { stored.removeValue(forKey: k) }
        save(stored, area: area)
    }
}
