import AVFoundation
import Speech
import SwiftUI

/// Native counterpart of extension/options.html. Web-facing settings are
/// written to the sync storage area under the same keys, so settings.ts and
/// content.ts read them unchanged and open pages update live.
///
/// The root holds what applies to everything; each app has its own page for
/// the settings that can differ between WaniKani and BunPro (SiteSettings).
struct SettingsView: View {
    @ObservedObject var app: AppModel
    @ObservedObject private var settings = SyncSettings.shared
    @ObservedObject private var speech = SpeechService.shared
    @AppStorage(Pref.developerMode) private var developerMode = false
    @AppStorage(Pref.showDebugBar) private var showDebugBar = false
    @AppStorage(Pref.showSayButton) private var showSayButton = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                PermissionSection()

                Section {
                    Toggle(isOn: settings.bool("keep_screen_awake")) {
                        labelled("Keep screen awake while listening", "A hands-free review has no touches to reset the idle timer")
                    }
                    Toggle(isOn: $speech.noiseReduction) {
                        labelled("Reduce background noise", "Filter out room noise and the page's own audio, like a phone call does. Other audio plays slightly quieter while Kikoe listens")
                    }
                    NavigationLink {
                        CorrectionsView()
                    } label: {
                        LabeledContent("Custom corrections", value: "\(settings.corrections.count)")
                    }
                } header: {
                    Text("General")
                } footer: {
                    Text("Corrections replace something the recognizer keeps mishearing with the answer you meant. Tap a no-match transcript to add one while reviewing.")
                }

                Section {
                    NavigationLink {
                        EnabledAppsView(app: app)
                    } label: {
                        LabeledContent("Enabled apps", value: app.enabledSites.map(\.name).joined(separator: ", "))
                    }
                } header: {
                    Text("Apps")
                } footer: {
                    Text("Kikoe only loads the apps that are on.")
                }

                Section {
                    ForEach(app.enabledSites) { site in
                        NavigationLink {
                            AppSettingsView(app: app, site: site)
                        } label: {
                            AppRow(app: app, site: site)
                        }
                    }
                } header: {
                    Text("App settings")
                } footer: {
                    Text("Review flow, Ippatsu, the live transcript and the recognizer are set separately for each app.")
                }

                Section {
                    if app.enabledSites.contains(where: { speech.usesTranscriberForJapanese($0) }) {
                        Toggle(isOn: $speech.dictationAssist) {
                            labelled("Dictation assist", "On Japanese cards, also run the dictation model and add its guesses. It follows the card's hints, which helps strict kanji readings, at some extra battery use")
                        }
                    }
                    Toggle(isOn: $speech.sendHints) {
                        labelled("Contextual hints", "Pass the card's accepted answers to the recognizer to bias it toward them")
                    }
                    Toggle(isOn: settings.bool("debug")) {
                        labelled("Debug logging", "Log speech matching, subject loading and token discovery to the web inspector")
                    }
                } header: { Text("Advanced") }

                Section {
                    Toggle("Developer mode", isOn: $developerMode)
                    if developerMode {
                        Toggle("Show debug bar", isOn: $showDebugBar)
                        Toggle("Show “Say” test button", isOn: $showSayButton)
                        NavigationLink("Recognition probe") { ProbeView() }
                    }
                } header: {
                    Text("Developer")
                } footer: {
                    if developerMode {
                        Text("Web Inspector access takes effect the next time Kikoe launches.")
                    }
                }

                Section {
                    LabeledContent("Version", value: Self.version)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }
}

private func labelled(_ title: String, _ hint: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
        Text(title)
        Text(hint).font(.footnote).foregroundStyle(.secondary)
    }
}

// MARK: - Apps

/// One row of the app settings list: the app and a line on how it's set up.
/// WaniKani gets a warning while it has no API token, since it can't look up
/// review items without one.
private struct AppRow: View {
    @ObservedObject var app: AppModel
    @ObservedObject private var settings = SyncSettings.shared
    let site: Site

    private var needsToken: Bool { site == .wanikani && settings.apiToken.isEmpty }

    var body: some View {
        HStack(spacing: 12) {
            SiteBadge(site: site, size: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(site.name)
                Text(needsToken ? "Needs an API token" : summary)
                    .font(.footnote)
                    .foregroundStyle(needsToken ? Color.orange : Color.secondary)
            }
            if needsToken {
                Spacer()
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundStyle(.orange)
                    .accessibilityLabel("API token missing")
            }
        }
    }

    private var summary: String {
        var parts: [String] = []
        if settings.bool("turbo", site: site).wrappedValue { parts.append("Turbo") }
        if settings.bool("ippatsu_meaning", site: site).wrappedValue
            || settings.bool("ippatsu_reading", site: site).wrappedValue { parts.append("Ippatsu") }
        if settings.bool("transcript", site: site).wrappedValue {
            parts.append("Transcript \(settings.string("transcript_position", site: site).wrappedValue)")
        } else {
            parts.append("No transcript")
        }
        return parts.joined(separator: " · ")
    }
}

/// Pick which apps Kikoe loads. At least one stays on.
private struct EnabledAppsView: View {
    @ObservedObject var app: AppModel

    var body: some View {
        Form {
            Section {
                ForEach(Site.allCases) { site in
                    let on = app.isEnabled(site)
                    Button {
                        // The last app stays on.
                        if !(on && app.enabledSites.count == 1) { app.setEnabled(site, !on) }
                    } label: {
                        HStack(spacing: 12) {
                            SiteBadge(site: site, size: 30)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(site.name).foregroundStyle(.primary)
                                Text(site.blurb).font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if on { Image(systemName: "checkmark").foregroundStyle(.primary) }
                        }
                    }
                    .buttonStyle(.plain)
                }
            } footer: {
                Text("Turn off the ones you don't use. Kikoe needs at least one on, and each one that's on gets its own settings page.")
            }
        }
        .navigationTitle("Enabled apps")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Everything that is set per app, on its own page.
private struct AppSettingsView: View {
    @ObservedObject var app: AppModel
    @ObservedObject private var settings = SyncSettings.shared
    @ObservedObject private var speech = SpeechService.shared
    let site: Site

    var body: some View {
        Form {
            if site == .wanikani { TokenSection(app: app) }

            Group {
                Section {
                    Toggle(isOn: settings.bool("turbo", site: site)) {
                        labelled("Turbo mode", "Auto-advance on a correct answer")
                    }
                    Toggle(isOn: settings.bool("speed_show_info", site: site)) {
                        labelled("Show item info on wrong answer", "Opens the item info panel when you answer incorrectly")
                    }
                    Toggle(isOn: settings.bool("strict_kanji_readings", site: site)) {
                        labelled("Strict kanji readings", "When the prompt is a single kanji, only accept kana the recognizer actually heard; it may ask you to repeat a reading it wrote back as the kanji")
                    }
                } header: { Text("Review flow") }

                Section {
                    Toggle("Meaning questions (English)", isOn: settings.bool("ippatsu_meaning", site: site))
                    Toggle("Reading questions (Japanese)", isOn: settings.bool("ippatsu_reading", site: site))
                } header: {
                    Text("Ippatsu mode（一発）")
                } footer: {
                    Text("One shot per question: a wrong answer is submitted instead of letting you retry.")
                }

                Section("Live transcript") {
                    Toggle(isOn: settings.bool("transcript", site: site)) {
                        labelled("Show live transcript", "Whether Kikoe is listening and what it hears, over the page")
                    }
                    Picker("Theme", selection: settings.string("transcript_theme", site: site)) {
                        Text("System").tag("system")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }
                    Picker("Position", selection: settings.string("transcript_position", site: site)) {
                        Text("Top").tag("top")
                        Text("Bottom").tag("bottom")
                    }
                    Toggle(isOn: settings.bool("show_help_button", site: site)) {
                        labelled("Show help button", "A ? button with voice commands and tips (saying “help” works either way)")
                    }
                }

                Section {
                    Picker("Recognizer", selection: Binding(
                        get: { speech.engineKind(for: site) },
                        set: { speech.setEngineKind($0, for: site) }
                    )) {
                        ForEach(availableEngines) { Text($0.rawValue).tag($0) }
                    }
                } header: {
                    Text("Speech recognizer")
                } footer: {
                    if let reason = speech.fallbackReason {
                        Text(reason)
                    } else {
                        Text("Automatic uses DictationTranscriber for WaniKani readings, which follows the card's hints, and SpeechTranscriber for meanings and for BunPro, which is better with grammar in context. Both need iOS 26; SFSpeechRecognizer works everywhere.")
                    }
                }
            }
        }
        .navigationTitle(site.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var availableEngines: [EngineKind] {
        if #available(iOS 26, *) { return EngineKind.allCases }
        return [.legacy]
    }
}

// MARK: - API token

private struct TokenSection: View {
    @ObservedObject var app: AppModel
    @ObservedObject private var settings = SyncSettings.shared
    @State private var draft = ""
    @State private var revealed = false
    @State private var status: WaniKaniToken.Status = .unchecked

    var body: some View {
        Section {
            HStack {
                Group {
                    if revealed {
                        TextField("Paste token", text: $draft)
                    } else {
                        SecureField("Paste token", text: $draft)
                    }
                }
                .font(.body.monospaced())
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onSubmit(save)
                Button { revealed.toggle() } label: {
                    Image(systemName: revealed ? "eye.slash" : "eye")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(revealed ? "Hide token" : "Show token")
            }
            statusRow
            Button("Find my token on WaniKani") { app.findApiToken() }
        } header: {
            Text("WaniKani API token")
        } footer: {
            Text("Kikoe uses a read-only personal access token to look up your review items. “Find my token” opens WaniKani's token page and reads the token from it; create one there first if you don't have one.")
        }
        .onAppear {
            draft = settings.apiToken
            if !draft.isEmpty { Task { await validate() } }
        }
        .onChange(of: draft) {
            if draft.trimmingCharacters(in: .whitespacesAndNewlines) != settings.apiToken {
                status = .unchecked
                save()
            }
        }
        .onChange(of: settings.apiToken) { _, token in
            // Captured from the token page while this screen was closed.
            if token != draft.trimmingCharacters(in: .whitespacesAndNewlines) { draft = token }
        }
    }

    @ViewBuilder
    private var statusRow: some View {
        let discovery = ExtensionStorage.value("kikoe_api_token_discovery_status", area: "local") as? String
        HStack {
            switch status {
            case .unchecked:
                if draft.isEmpty {
                    if discovery == "not_found" {
                        Label("No token found on that page. Create one, then try again.", systemImage: "exclamationmark.circle")
                            .foregroundStyle(.orange)
                    } else {
                        Label("No token yet", systemImage: "key").foregroundStyle(.secondary)
                    }
                } else {
                    Button("Check token") { Task { await validate() } }
                }
            case .checking:
                ProgressView()
                Text("Checking…").foregroundStyle(.secondary)
            case let .valid(user):
                Label("Signed in as \(user)", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            case let .invalid(reason):
                Label(reason, systemImage: "xmark.circle.fill").foregroundStyle(.red)
            }
            Spacer()
        }
        .font(.subheadline)
    }

    private func save() {
        settings.apiToken = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func validate() async {
        let token = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return }
        status = .checking
        status = await WaniKaniToken.check(token)
    }
}

enum WaniKaniToken {
    enum Status: Equatable {
        case unchecked, checking, valid(String), invalid(String)
    }

    static func check(_ token: String) async -> Status {
        var request = URLRequest(url: URL(string: "https://api.wanikani.com/v2/user")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("20170710", forHTTPHeaderField: "Wanikani-Revision")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            switch code {
            case 200:
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                let user = (json?["data"] as? [String: Any])?["username"] as? String ?? "WaniKani user"
                return .valid(user)
            case 401:
                return .invalid("WaniKani didn't accept this token")
            default:
                return .invalid("WaniKani returned an error (\(code))")
            }
        } catch {
            return .invalid("Couldn't reach WaniKani")
        }
    }
}

// MARK: - Permissions

private struct PermissionSection: View {
    @State private var denied = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if denied {
                Section {
                    Label("Kikoe can't use the microphone or speech recognition.", systemImage: "mic.slash")
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        Link("Open iOS Settings", destination: url)
                    }
                } header: { Text("Microphone access") }
            }
        }
        .onAppear(perform: refresh)
        .onChange(of: scenePhase) { refresh() }
    }

    private func refresh() {
        denied = AVAudioApplication.shared.recordPermission == .denied
            || SFSpeechRecognizer.authorizationStatus() == .denied
    }
}

// MARK: - Corrections

private struct CorrectionsView: View {
    @ObservedObject private var settings = SyncSettings.shared
    @State private var editing: SyncSettings.Correction?
    @State private var adding = false

    var body: some View {
        List {
            if settings.corrections.isEmpty {
                Text("No corrections yet. When a transcript shows “no match”, tap it to save what you meant.")
                    .foregroundStyle(.secondary)
            }
            ForEach(settings.corrections) { correction in
                Button { editing = correction } label: {
                    HStack {
                        Text(correction.heard)
                        Image(systemName: "arrow.right").foregroundStyle(.secondary)
                        Text(correction.intended).fontWeight(.semibold)
                    }
                    .foregroundStyle(.primary)
                }
            }
            .onDelete { offsets in
                var list = settings.corrections
                list.remove(atOffsets: offsets)
                settings.corrections = list
            }
        }
        .navigationTitle("Custom corrections")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Add correction")
            }
            if !settings.corrections.isEmpty {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
            }
        }
        .sheet(item: $editing) { correction in
            CorrectionEditor(original: correction)
        }
        .sheet(isPresented: $adding) {
            CorrectionEditor(original: nil)
        }
    }
}

private struct CorrectionEditor: View {
    let original: SyncSettings.Correction?
    @State private var heard = ""
    @State private var intended = ""
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Heard", text: $heard)
                    TextField("Intended answer", text: $intended)
                } footer: {
                    Text("Whenever the recognizer hears the first, Kikoe answers with the second.")
                }
                if let original {
                    Section {
                        Button("Delete correction", role: .destructive) {
                            SyncSettings.shared.corrections.removeAll { $0 == original }
                            dismiss()
                        }
                    }
                }
            }
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .navigationTitle(original == nil ? "New correction" : "Edit correction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        SyncSettings.shared.saveCorrection(.init(heard: heard, intended: intended), replacing: original)
                        dismiss()
                    }
                    .disabled(heard.trimmingCharacters(in: .whitespaces).isEmpty
                              || intended.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                heard = original?.heard ?? ""
                intended = original?.intended ?? ""
            }
        }
        .presentationDetents([.medium])
    }
}
