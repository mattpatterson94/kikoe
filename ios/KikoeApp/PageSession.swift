import SwiftUI
import WebKit

/// What the page's overlay modules last asked the app to draw (see
/// src/native_ui.ts for the other side of this).
struct IndicatorState: Equatable {
    enum Tone: String { case normal, error, muted }
    var state: String
    var label: String
    var tone: Tone
}

struct TranscriptBubble: Equatable, Identifiable {
    struct Correction: Equatable { var heard: String; var intended: String }
    let id = UUID()
    var text: String
    var detail: String?
    var error: Bool
    var correction: Correction?
}

struct HelpContent: Equatable {
    struct Command: Equatable, Hashable { var phrases: String; var description: String }
    var language: String
    var commands: [Command]
    var tips: [String]
    var guideURL: URL?
}

/// One site's web view, kept alive while the user switches away, plus the
/// overlay state its page has published.
@MainActor
final class PageSession: NSObject, ObservableObject {
    /// The isolated world the content script runs in. Page JS can't see
    /// anything defined or registered here.
    static let contentWorld = WKContentWorld.world(name: "Kikoe")

    let site: Site
    let webView: WKWebView
    weak var app: AppModel?

    @Published private(set) var indicator: IndicatorState?
    @Published private(set) var transcript: TranscriptBubble?
    @Published private(set) var helpButtonVisible = false
    @Published var help: HelpContent?
    @Published private(set) var hint: String?
    @Published private(set) var isLoading = false

    private var storageObserver: NSObjectProtocol?
    private var needsReload = false

    init(site: Site, app: AppModel) {
        self.site = site
        self.app = app
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        install(into: config.userContentController)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        #if DEBUG
        webView.isInspectable = true
        #else
        webView.isInspectable = UserDefaults.standard.bool(forKey: Pref.developerMode)
        #endif
        storageObserver = NotificationCenter.default.addObserver(
            forName: .kikoeStorageChanged, object: nil, queue: .main
        ) { [weak self] note in
            MainActor.assumeIsolated { self?.relayStorageChange(note) }
        }
        loadInitialPage()
    }

    deinit {
        if let storageObserver { NotificationCenter.default.removeObserver(storageObserver) }
    }

    private func loadInitialPage() {
        #if DEBUG
        // KIKOE_FIXTURE=<path to tests/fixtures/*.html> loads a frozen review
        // card under the site's origin, so the real adapter, the content
        // world and the overlays can be exercised without an account.
        if let path = ProcessInfo.processInfo.environment["KIKOE_FIXTURE"],
           ProcessInfo.processInfo.environment["KIKOE_SITE"] == site.rawValue,
           let html = try? String(contentsOfFile: path, encoding: .utf8) {
            webView.loadHTMLString(html, baseURL: URL(string: site.reviewPath, relativeTo: site.home)?.absoluteURL)
            return
        }
        #endif
        webView.load(URLRequest(url: site.home))
    }

    /// The app was turned off: stop listening and let the page go.
    func close() {
        SpeechService.shared.release(self)
        webView.stopLoading()
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        webView.removeFromSuperview()
    }

    func load(_ url: URL) {
        webView.load(URLRequest(url: url))
    }

    func goHome() { load(site.home) }

    /// The way out when the page or recognition gets stuck: stop listening
    /// and load the page again; app.ts starts afresh when it comes back.
    func reload() {
        SpeechService.shared.release(self)
        if webView.url == nil { goHome() } else { webView.reload() }
    }

    /// Called when the session's web view goes back on screen.
    func didBecomeVisible() {
        if needsReload {
            needsReload = false
            webView.reload()
        }
    }

    // MARK: - Scripts and handlers

    private func install(into controller: WKUserContentController) {
        let proxy = WeakScriptHandler(self)
        guard let web = Bundle.main.url(forResource: "KikoeWeb", withExtension: nil),
              let contentShim = Self.resource("ContentWorldShim", "js"),
              let pageShim = Self.resource("PageShim", "js"),
              let content = try? String(contentsOf: web.appendingPathComponent("content.js"), encoding: .utf8)
        else {
            NSLog("[kikoe] KikoeWeb resources missing — run `npm run build` before building the app")
            return
        }
        controller.addUserScript(WKUserScript(source: pageShim, injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true, in: .page))
        // Matches the manifest's run_at: document_end, top frame only.
        let source = "(function () {\n\(contentShim)\n(function (chrome) {\n\(content)\n})(kikoeChrome);\n})();"
        controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd,
                                              forMainFrameOnly: true, in: Self.contentWorld))

        controller.addScriptMessageHandler(proxy, contentWorld: Self.contentWorld, name: "kikoeExt")
        controller.addScriptMessageHandler(proxy, contentWorld: .page, name: "kikoeResource")
        controller.add(proxy, contentWorld: .page, name: "kikoeSpeech")
        controller.add(proxy, contentWorld: .page, name: "kikoeUI")
        controller.add(proxy, contentWorld: .page, name: "kikoeLog")
    }

    private static func resource(_ name: String, _ ext: String) -> String? {
        Bundle.main.url(forResource: name, withExtension: ext).flatMap { try? String(contentsOf: $0, encoding: .utf8) }
    }

    /// Only the web build's own files, read-only. Page JS can ask for these
    /// (they're public anyway), never for storage.
    private static func webAsset(_ path: String) -> String? {
        guard !path.isEmpty, !path.contains(".."), !path.hasPrefix("/"),
              let url = Bundle.main.url(forResource: "KikoeWeb", withExtension: nil)?.appendingPathComponent(path)
        else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    fileprivate func didReceive(_ message: WKScriptMessage) {
        switch message.name {
        case "kikoeSpeech":
            guard let body = message.body as? [String: Any] else { return }
            SpeechService.shared.handle(body, from: self)
        case "kikoeUI":
            guard let body = message.body as? [String: Any] else { return }
            handleOverlay(body)
        case "kikoeLog":
            NSLog("[page:\(site.rawValue)] \(message.body)")
        default:
            break
        }
    }

    fileprivate func didReceive(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any] else { return reply(nil, "bad message") }
        if message.name == "kikoeResource" {
            let path = body["path"] as? String ?? ""
            guard let text = Self.webAsset(path) else { return reply(nil, "missing \(path)") }
            return reply(text, nil)
        }
        // Everything below is the content script's (isolated world only).
        guard message.name == "kikoeExt", message.world == Self.contentWorld,
              let op = body["op"] as? String else { return reply(nil, "bad message") }
        let area = body["area"] as? String ?? "sync"
        switch op {
        case "storage.get":
            let keys = (body["keys"] as? String).flatMap(Self.parse)
            reply(Self.json(ExtensionStorage.get(area: area, keys: keys)), nil)
        case "storage.set":
            let items = (body["items"] as? String).flatMap(Self.parse) as? [String: Any] ?? [:]
            ExtensionStorage.set(area: area, items: items)
            reply("null", nil)
        case "storage.remove":
            ExtensionStorage.remove(area: area, keys: (body["keys"] as? String).flatMap(Self.parse))
            reply("null", nil)
        case "runtime.sendMessage":
            let msg = (body["message"] as? String).flatMap(Self.parse) as? [String: Any]
            handleRuntimeMessage(msg?["type"] as? String)
            reply("null", nil)
        case "inject":
            // injected.js / bundle.js, evaluated in the page world where the
            // DOM <script src> would have run them.
            let name = body["name"] as? String ?? ""
            guard let js = Self.webAsset(name) else { return reply(nil, "missing \(name)") }
            webView.evaluateJavaScript(js + "\n;0", in: nil, in: .page) { result in
                if case let .failure(error) = result { NSLog("[kikoe] \(name) failed: \(error)") }
            }
            reply("null", nil)
        case "log":
            NSLog("[\(site.rawValue)] \(body["text"] as? String ?? "")")
            reply("null", nil)
        default:
            reply(nil, "unknown op \(op)")
        }
    }

    private func handleRuntimeMessage(_ type: String?) {
        switch type {
        case "kikoe:openOptions":
            // Sent after a successful token capture, too: leave the token
            // page so the next review starts from the dashboard.
            if webView.url?.path == Site.apiTokenPage.path { goHome() }
            app?.showSettings = true
        case "kikoe:openApiTokenPage":
            app?.findApiToken()
        default:
            break
        }
    }

    /// chrome.storage.onChanged for the content script. Only the sync area
    /// is relayed: that's all content.ts listens to, and the local area's
    /// writes are the (large) subject cache.
    private func relayStorageChange(_ note: Notification) {
        guard let area = note.userInfo?["area"] as? String, area == "sync",
              let changes = note.userInfo?["changes"] else { return }
        let js = "window.__kikoeStorageChanged && window.__kikoeStorageChanged(\(Self.json(changes)), \(Self.json(area)));"
        webView.evaluateJavaScript(js, in: nil, in: Self.contentWorld, completionHandler: nil)
    }

    // MARK: - Speech

    func deliverSpeech(_ payload: [String: Any]) {
        dispatch("kikoe:nativeSpeech", detail: payload)
    }

    // MARK: - Overlays

    private var transcriptTimer: Task<Void, Never>?
    private var hintTimer: Task<Void, Never>?

    private func handleOverlay(_ body: [String: Any]) {
        switch body["type"] as? String {
        case "indicator":
            indicator = IndicatorState(
                state: body["state"] as? String ?? "",
                label: body["label"] as? String ?? "",
                tone: (body["tone"] as? String).flatMap(IndicatorState.Tone.init(rawValue:)) ?? .normal)
        case "transcript":
            var correction: TranscriptBubble.Correction?
            if let c = body["correction"] as? [String: Any],
               let heard = c["heard"] as? String, let intended = c["intended"] as? String {
                correction = .init(heard: heard, intended: intended)
            }
            transcript = TranscriptBubble(
                text: body["text"] as? String ?? "",
                detail: body["detail"] as? String,
                error: body["error"] as? Bool ?? false,
                correction: correction)
            transcriptTimer?.cancel()
            // The DOM chips fade after a few seconds; a correction offer
            // stays a little longer so there's time to tap it.
            let seconds: UInt64 = correction == nil ? 5 : 10
            transcriptTimer = Task { [weak self] in
                try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
                guard !Task.isCancelled else { return }
                self?.transcript = nil
            }
        case "clearTranscript":
            transcriptTimer?.cancel()
            transcript = nil
        case "helpButton":
            helpButtonVisible = body["visible"] as? Bool ?? false
        case "help":
            if body["open"] as? Bool == true {
                let commands = (body["commands"] as? [[String: Any]] ?? []).map {
                    HelpContent.Command(phrases: $0["phrases"] as? String ?? "",
                                        description: $0["description"] as? String ?? "")
                }
                help = HelpContent(language: body["language"] as? String ?? "",
                                   commands: commands,
                                   tips: body["tips"] as? [String] ?? [],
                                   guideURL: (body["guideUrl"] as? String).flatMap(URL.init(string:)))
            } else {
                help = nil
            }
        case "helpHint":
            hint = body["text"] as? String
            hintTimer?.cancel()
            hintTimer = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                guard !Task.isCancelled else { return }
                self?.hint = nil
            }
        default:
            break
        }
    }

    func sendAction(_ action: String) {
        dispatch("kikoe:nativeUi", detail: ["action": action])
    }

    /// The sheet was swiped away (or closed with its button): tell help.ts,
    /// which resumes listening.
    func helpDismissed() {
        guard help != nil else { return }
        help = nil
        sendAction("helpDismissed")
    }

    /// Same event the DOM bubble's confirm() fires: content.ts saves the
    /// correction to sync storage and app.ts submits the intended answer.
    func confirmCorrection(_ correction: TranscriptBubble.Correction) {
        transcript = nil
        dispatch("kikoe:addCorrection", detail: ["heard": correction.heard, "intended": correction.intended])
    }

    private func dispatch(_ event: String, detail: [String: Any]) {
        let js = "document.dispatchEvent(new CustomEvent(\(Self.json(event)), { detail: \(Self.json(detail)) }));"
        webView.evaluateJavaScript(js, in: nil, in: .page, completionHandler: nil)
    }

    private func resetOverlays() {
        indicator = nil
        transcript = nil
        helpButtonVisible = false
        help = nil
        hint = nil
    }

    // MARK: - JSON

    private static func parse(_ s: String) -> Any? {
        try? JSONSerialization.jsonObject(with: Data(s.utf8), options: [.fragmentsAllowed])
    }

    static func json(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else { return "null" }
        return String(data: data, encoding: .utf8) ?? "null"
    }
}

// MARK: - Navigation

extension PageSession: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        isLoading = true
        // A new document means a new app.ts; it re-posts its own state.
        SpeechService.shared.release(self)
        resetOverlays()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoading = false
        #if DEBUG
        // KIKOE_EVAL_PAGE=<js> runs in the page world 3s after each load,
        // for poking at the bridge from the command line.
        if let js = ProcessInfo.processInfo.environment["KIKOE_EVAL_PAGE"] {
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                webView.evaluateJavaScript(js + "\n;0", in: nil, in: .page) { result in
                    if case let .failure(error) = result { NSLog("[kikoe] KIKOE_EVAL_PAGE failed: \(error)") }
                }
            }
        }
        #endif
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        isLoading = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        isLoading = false
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // iOS reclaims background web content processes under memory
        // pressure. Reload now if on screen, else when switched back to.
        SpeechService.shared.release(self)
        resetOverlays()
        if webView.window != nil { webView.reload() } else { needsReload = true }
    }

    /// target=_blank links (the help guide, external sites) open in Safari
    /// rather than replacing the review page.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        app?.presentAlert(message: message, confirm: false) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        app?.presentAlert(message: message, confirm: true, completion: completionHandler)
    }
}

/// WKUserContentController retains its handlers; this breaks the cycle
/// between it and the session that owns the web view.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler, WKScriptMessageHandlerWithReply {
    weak var session: PageSession?
    init(_ session: PageSession) { self.session = session }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated { session?.didReceive(message) }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        MainActor.assumeIsolated {
            guard let session else { return replyHandler(nil, "gone") }
            session.didReceive(message) { replyHandler($0, $1) }
        }
    }
}
