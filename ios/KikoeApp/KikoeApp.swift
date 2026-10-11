import SwiftUI
import WebKit

@main
struct KikoeApp: App {
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-probe") {
                NavigationStack { ProbeView() }
            } else {
                RootView()
            }
            #else
            RootView()
            #endif
        }
    }
}

struct RootView: View {
    @StateObject private var app = AppModel()

    var body: some View {
        Group {
            if app.onboarded {
                SessionScreen(app: app, session: app.current)
                    .transition(.opacity)
            } else {
                OnboardingView(app: app)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: app.onboarded)
            .sheet(isPresented: $app.showSettings) {
                SettingsView(app: app)
            }
            .alert(app.alert?.message ?? "", isPresented: Binding(
                get: { app.alert != nil },
                set: { if !$0 { app.alert = nil } }
            ), presenting: app.alert) { alert in
                if alert.confirm {
                    Button("Cancel", role: .cancel) { alert.completion(false); app.alert = nil }
                    Button("OK") { alert.completion(true); app.alert = nil }
                } else {
                    Button("OK") { alert.completion(true); app.alert = nil }
                }
            }
    }
}

/// The current site's page with Kikoe's controls around it.
struct SessionScreen: View {
    @ObservedObject var app: AppModel
    @ObservedObject var session: PageSession
    @ObservedObject private var settings = SyncSettings.shared
    @AppStorage(Pref.developerMode) private var developerMode = false
    @AppStorage(Pref.showDebugBar) private var showDebugBar = false
    @State private var pendingCorrection: TranscriptBubble.Correction?

    var body: some View {
        NavigationStack {
            WebContainer(session: session)
                .ignoresSafeArea(edges: .bottom)
                .overlay(alignment: .top) {
                    VStack(spacing: 8) {
                        if session.isLoading {
                            ProgressView().progressViewStyle(.linear).tint(session.site.tint)
                        }
                        if let indicator = session.indicator, indicator.needsAttention {
                            IndicatorBanner(indicator: indicator) { session.sendAction("indicatorTapped") }
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }
                        if let hint = session.hint {
                            HintToast(text: hint).transition(.move(edge: .top).combined(with: .opacity))
                        }
                        if let bubble = session.transcript, !bubble.atBottom { transcript(bubble) }
                    }
                    .padding(.horizontal)
                }
                .overlay(alignment: .bottom) {
                    if let bubble = session.transcript, bubble.atBottom {
                        transcript(bubble).padding()
                    }
                }
                .animation(.easeOut(duration: 0.2), value: session.transcript)
                .animation(.easeOut(duration: 0.3), value: session.hint)
                .animation(.easeOut(duration: 0.3), value: session.indicator)
                .safeAreaInset(edge: .top, spacing: 0) {
                    if developerMode && showDebugBar { DebugBar() }
                }
                .toolbar { toolbar }
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(.visible, for: .navigationBar)
                .sheet(isPresented: Binding(
                    get: { session.help != nil },
                    set: { if !$0 { session.helpDismissed() } }
                )) {
                    if let help = session.help {
                        HelpSheet(help: help) { session.helpDismissed() }
                            .presentationDetents([.medium, .large])
                    }
                }
                .confirmationDialog(
                    "Create a speech correction?",
                    isPresented: Binding(get: { pendingCorrection != nil }, set: { if !$0 { pendingCorrection = nil } }),
                    titleVisibility: .visible,
                    presenting: pendingCorrection
                ) { correction in
                    Button("Save and use “\(correction.intended)”") { session.confirmCorrection(correction) }
                    Button("Cancel", role: .cancel) {}
                } message: { correction in
                    Text("Heard: \(correction.heard)\nIntended answer: \(correction.intended)\n\nFrom now on, hearing “\(correction.heard)” counts as “\(correction.intended)”.")
                }
        }
    }

    private func transcript(_ bubble: TranscriptBubble) -> some View {
        TranscriptView(bubble: bubble) { pendingCorrection = $0 }
            .environment(\.colorScheme, settings.transcriptScheme ?? colorScheme)
            .transition(.opacity.combined(with: .scale(scale: 0.95)))
    }

    @Environment(\.colorScheme) private var colorScheme

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            if let indicator = session.indicator {
                IndicatorPill(indicator: indicator) { session.sendAction("indicatorTapped") }
            }
        }
        ToolbarItem(placement: .principal) {
            SiteMenu(app: app)
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            if session.helpButtonVisible {
                Button { session.sendAction("helpButtonTapped") } label: {
                    Image(systemName: "questionmark.circle")
                }
                .accessibilityLabel("Voice commands")
            }
            Button { app.showSettings = true } label: { Image(systemName: "gearshape") }
                .accessibilityLabel("Settings")
        }
    }
}

/// Hosts whichever session's web view is current. Only that one is in the
/// window; the others stay alive off-screen, where WebKit marks their
/// documents hidden and app.ts stops listening on its own.
struct WebContainer: UIViewRepresentable {
    let session: PageSession

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .systemBackground
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        let webView = session.webView
        guard webView.superview !== container else { return }
        container.subviews.forEach { $0.removeFromSuperview() }
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        session.didBecomeVisible()
    }
}

/// Developer: engine, locale and what was last heard, plus a TTS "Say"
/// button that feeds synthetic speech into the recognizer.
struct DebugBar: View {
    @ObservedObject private var speech = SpeechService.shared
    @AppStorage(Pref.showSayButton) private var showSayButton = false
    @State private var sayText = "かい"

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(speech.listening ? .green : .gray).frame(width: 8, height: 8)
            Text(speech.listening ? "\(speech.currentLocale) · \(speech.runningKind.rawValue)" : "idle")
                .font(.caption2.monospaced())
            Text(speech.lastHeard.joined(separator: " · ")).font(.caption2).lineLimit(1)
            Spacer()
            if showSayButton {
                TextField("say", text: $sayText).font(.caption).frame(width: 90).textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled().textInputAutocapitalization(.never)
                Button("Say") { Task { await speech.injectSpeech(sayText) } }.font(.caption)
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(.bar)
        #if DEBUG
        .onAppear { if let say = ProcessInfo.processInfo.environment["KIKOE_SAY"] { sayText = say } }
        #endif
    }
}
