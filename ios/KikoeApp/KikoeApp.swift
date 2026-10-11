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
    @ObservedObject private var speech = SpeechService.shared
    @AppStorage(Pref.developerMode) private var developerMode = false
    @AppStorage(Pref.showDebugBar) private var showDebugBar = false
    @State private var pendingCorrection: TranscriptBubble.Correction?
    @State private var choosingLanguage = false

    var body: some View {
        NavigationStack {
            WebContainer(session: session)
                .ignoresSafeArea(edges: .bottom)
                .overlay(alignment: .top) {
                    VStack(spacing: 8) {
                        if session.isLoading {
                            ProgressView().progressViewStyle(.linear).tint(session.site.tint)
                        }
                        if bubbleIndicator == nil, let indicator = session.indicator, indicator.needsAttention {
                            IndicatorBanner(indicator: indicator) { session.sendAction("indicatorTapped") }
                                .transition(slideIn)
                        }
                        if let hint = session.hint {
                            HintToast(text: hint).transition(slideIn)
                        }
                        if !bubbleAtBottom, let indicator = bubbleIndicator { transcript(indicator) }
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)
                }
                .overlay(alignment: .bottom) {
                    if bubbleAtBottom, let indicator = bubbleIndicator {
                        transcript(indicator).padding()
                    }
                }
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
                .sheet(isPresented: $choosingLanguage) {
                    LanguageSheet(speech: speech) { choosingLanguage = false }
                }
                .sheet(isPresented: Binding(get: { pendingCorrection != nil }, set: { if !$0 { pendingCorrection = nil } })) {
                    if let correction = pendingCorrection {
                        CorrectionSheet(
                            correction: correction,
                            onSave: { session.confirmCorrection(correction); pendingCorrection = nil },
                            onCancel: { pendingCorrection = nil })
                    }
                }
        }
    }

    /// The bubble shows for the whole review (the page posts an indicator
    /// only while Kikoe is active), not just after speech. It also carries
    /// problem states, so the banner only shows when the bubble is off.
    private var bubbleIndicator: IndicatorState? {
        settings.bool("transcript").wrappedValue ? session.indicator : nil
    }
    private var bubbleAtBottom: Bool { settings.string("transcript_position").wrappedValue != "top" }

    private func transcript(_ indicator: IndicatorState) -> some View {
        TranscriptView(
            indicator: indicator,
            bubble: session.transcript,
            level: speech.mic.level,
            languageOverride: speech.languageOverride,
            resultAbove: bubbleAtBottom,
            onMic: { session.sendAction("indicatorTapped") },
            onCorrection: { pendingCorrection = $0 })
            .environment(\.colorScheme, settings.transcriptScheme ?? colorScheme)
    }

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Banners slide down from the nav bar, or just fade with Reduce Motion.
    private var slideIn: AnyTransition {
        reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity)
    }

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
        ToolbarItem(placement: .topBarTrailing) {
            SessionMenu(listening: speech.listening, helpButtonVisible: session.helpButtonVisible,
                        reload: { session.reload() },
                        chooseLanguage: { choosingLanguage = true },
                        showHelp: { session.sendAction("helpButtonTapped") },
                        openSettings: { app.showSettings = true })
                .equatable()
        }
    }
}

/// The nav bar's More menu: ways out when something goes wrong mid-review,
/// then the voice-command help (when the help button setting is on) and
/// Settings.
///
/// It only takes plain values and is compared with `.equatable()`, so the
/// screen re-rendering for every transcript and level change doesn't rebuild
/// it. A Menu rebuilt while a tap is landing drops the tap, which made the
/// button need a second press.
struct SessionMenu: View, Equatable {
    let listening: Bool
    let helpButtonVisible: Bool
    let reload: () -> Void
    let chooseLanguage: () -> Void
    let showHelp: () -> Void
    let openSettings: () -> Void

    static func == (lhs: SessionMenu, rhs: SessionMenu) -> Bool {
        lhs.listening == rhs.listening && lhs.helpButtonVisible == rhs.helpButtonVisible
    }

    var body: some View {
        Menu {
            Button(action: reload) {
                Label("Reload Page", systemImage: "arrow.clockwise")
            }
            Button(action: chooseLanguage) {
                Label("Listen In…", systemImage: "character.bubble")
            }
            .disabled(!listening)
            Divider()
            if helpButtonVisible {
                Button(action: showHelp) {
                    Label("Voice Commands", systemImage: "questionmark.circle")
                }
            }
            Button(action: openSettings) {
                Label("Settings", systemImage: "gearshape")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel("More")
    }
}

enum SpeechLanguage {
    static let japanese = "ja-JP"
    static let english = "en-US"

    static func name(_ locale: String) -> String {
        locale.hasPrefix("ja") ? "Japanese" : "English"
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
