import SwiftUI
import WebKit

@main
struct KikoeSpikeApp: App {
    var body: some Scene {
        WindowGroup {
            if ProcessInfo.processInfo.arguments.contains("-probe") {
                NavigationStack { ProbeView() }
            } else {
                ContentView()
            }
        }
    }
}

enum Site: String, CaseIterable, Identifiable {
    case wanikani = "WaniKani"
    case bunpro = "BunPro"
    var id: String { rawValue }
    var url: URL {
        switch self {
        case .wanikani: URL(string: "https://www.wanikani.com/dashboard")!
        case .bunpro: URL(string: "https://bunpro.jp/dashboard")!
        }
    }
}

/// How the webview identifies itself. Google refuses OAuth in embedded
/// webviews (`disallowed_useragent`), detected largely by the missing
/// "Safari/" token in WKWebView's default UA. The Safari-like mode exists to
/// test that, not as a recommendation: it's against Google's policy.
enum UserAgentMode: String, CaseIterable, Identifiable {
    case webView = "WKWebView default"
    case safari = "Safari-like"
    var id: String { rawValue }
    var applicationName: String? {
        switch self {
        case .webView: nil
        case .safari: "Version/26.0 Mobile/15E148 Safari/604.1"
        }
    }
}

struct ContentView: View {
    @StateObject private var bridge = KikoeBridge()
    @State private var site: Site = Site(rawValue: ProcessInfo.processInfo.environment["KIKOE_SITE"] ?? "") ?? .wanikani
    @State private var uaMode: UserAgentMode = .webView
    @State private var sayText = ProcessInfo.processInfo.environment["KIKOE_SAY"] ?? "かい"
    @State private var showProbe = false

    var body: some View {
        NavigationStack {
            WebView(bridge: bridge, url: site.url, uaMode: uaMode)
                .id("\(site.rawValue)|\(uaMode.rawValue)")
                .ignoresSafeArea(edges: .bottom)
                .safeAreaInset(edge: .top) { debugBar }
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        Picker("Site", selection: $site) {
                            ForEach(Site.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { bridge.showSettings = true } label: { Image(systemName: "gearshape") }
                    }
                }
                .navigationBarTitleDisplayMode(.inline)
                .sheet(isPresented: $bridge.showSettings) { settings }
                .sheet(isPresented: $showProbe) { NavigationStack { ProbeView() } }
        }
    }

    private var debugBar: some View {
        HStack(spacing: 8) {
            Circle().fill(bridge.listening ? .green : .gray).frame(width: 8, height: 8)
            Text(bridge.listening ? "\(bridge.currentLocale) · \(bridge.engineKind.rawValue)" : "idle")
                .font(.caption2.monospaced())
            Text(bridge.lastHeard.joined(separator: " · ")).font(.caption2).lineLimit(1)
            Spacer()
            TextField("say", text: $sayText).font(.caption).frame(width: 90).textFieldStyle(.roundedBorder)
                .autocorrectionDisabled().textInputAutocapitalization(.never)
            Button("Say") { Task { await bridge.injectSpeech(sayText) } }.font(.caption)
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(.bar)
    }

    private var settings: some View {
        NavigationStack {
            Form {
                Section("Recognizer") {
                    Picker("Engine", selection: $bridge.engineKind) {
                        ForEach(EngineKind.allCases) { Text($0.rawValue).tag($0) }
                    }
                    Toggle("Send card answers as contextual strings", isOn: $bridge.sendHints)
                    Text("Hints now: \(bridge.currentHints.joined(separator: ", "))").font(.footnote)
                }
                Section("WaniKani API token") {
                    TextField("token", text: Binding(
                        get: { ExtensionStorage.all(area: "sync")["apiToken"] as? String ?? "" },
                        set: { _ = ExtensionStorage.set(area: "sync", items: ["apiToken": $0]) }))
                        .autocorrectionDisabled().textInputAutocapitalization(.never)
                }
                Section("Web view") {
                    Picker("User agent", selection: $uaMode) {
                        ForEach(UserAgentMode.allCases) { Text($0.rawValue).tag($0) }
                    }
                }
                Section {
                    Button("Recognition probe…") { bridge.showSettings = false; showProbe = true }
                }
            }
            .navigationTitle("Kikoe spike")
            .toolbar { Button("Done") { bridge.showSettings = false } }
        }
    }
}

struct WebView: UIViewRepresentable {
    let bridge: KikoeBridge
    let url: URL
    let uaMode: UserAgentMode

    func makeCoordinator() -> KikoeBridge { bridge }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        if let name = uaMode.applicationName { config.applicationNameForUserAgent = name }
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        bridge.install(into: config.userContentController)
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isInspectable = true
        webView.allowsBackForwardNavigationGestures = true
        bridge.webView = webView
        // Debug: KIKOE_FIXTURE=<path to tests/fixtures/*.html> loads a frozen
        // review card under the site's origin, so the real adapter and the
        // native bridge can be exercised without an account.
        if let path = ProcessInfo.processInfo.environment["KIKOE_FIXTURE"],
           let html = try? String(contentsOfFile: path, encoding: .utf8) {
            webView.loadHTMLString(html, baseURL: url.deletingLastPathComponent().appendingPathComponent("reviews"))
        } else {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: KikoeBridge) {
        coordinator.stopListening()
        let controller = webView.configuration.userContentController
        controller.removeAllScriptMessageHandlers()
        controller.removeAllUserScripts()
    }
}
