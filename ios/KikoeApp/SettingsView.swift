import AVFoundation
import Speech
import SwiftUI

/// Native counterpart of extension/options.html. Web-facing settings are
/// written to the sync storage area under the same keys, so settings.ts and
/// content.ts read them unchanged and open pages update live.
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
                TokenSection(app: app)
                PermissionSection()

                Section {
                    Toggle(isOn: settings.bool("turbo")) {
                        labelled("Turbo mode", "Auto-advance on a correct answer")
                    }
                    Toggle(isOn: settings.bool("speed_show_info")) {
                        labelled("Show item info on wrong answer", "Opens the item info panel when you answer incorrectly")
                    }
                } header: { Text("Turbo") }

                Section {
                    Toggle("Meaning questions (English)", isOn: settings.bool("ippatsu_meaning"))
                    Toggle("Reading questions (Japanese)", isOn: settings.bool("ippatsu_reading"))
                } header: {
                    Text("Ippatsu mode（一発）")
                } footer: {
                    Text("One shot per question: a wrong answer is submitted instead of letting you retry.")
                }

                Section("Live transcript") {
                    Toggle(isOn: settings.bool("transcript")) {
                        labelled("Show live transcript", "What Kikoe hears, over the page")
                    }
                    Picker("Theme", selection: settings.string("transcript_theme")) {
                        Text("System").tag("system")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }
                    Picker("Position", selection: settings.string("transcript_position")) {
                        Text("Top").tag("top")
                        Text("Bottom").tag("bottom")
                    }
                    Toggle(isOn: settings.bool("show_help_button")) {
                        labelled("Show help button", "A ? button with voice commands and tips (saying “help” works either way)")
                    }
                }

                Section("Screen") {
                    Toggle(isOn: settings.bool("keep_screen_awake")) {
                        labelled("Keep screen awake while listening", "A hands-free review has no touches to reset the idle timer")
                    }
                }

                Section {
                    NavigationLink {
                        CorrectionsView()
                    } label: {
                        LabeledContent("Custom corrections", value: "\(settings.corrections.count)")
                    }
                } footer: {
                    Text("Replace something the recognizer keeps mishearing with the answer you meant. Tap a no-match transcript to add one while reviewing.")
                }

                Section {
                    Toggle(isOn: settings.bool("strict_kanji_readings")) {
                        labelled("Strict kanji readings", "When the prompt is a single kanji, only accept kana the recognizer actually heard; it may ask you to repeat a reading it wrote back as the kanji")
                    }
                } header: { Text("Kanji readings") }

                Section {
                    Picker("Recognizer", selection: $speech.engineKind) {
                        ForEach(availableEngines) { Text($0.rawValue).tag($0) }
                    }
                    Toggle(isOn: $speech.sendHints) {
                        labelled("Contextual hints", "Pass the card's accepted answers to the recognizer to bias it toward them")
                    }
                    Toggle(isOn: settings.bool("debug")) {
                        labelled("Debug logging", "Log speech matching, subject loading and token discovery to the web inspector")
                    }
                } header: {
                    Text("Advanced")
                } footer: {
                    if let reason = speech.fallbackReason {
                        Text(reason)
                    } else {
                        Text("SpeechTranscriber (iOS 26) is the most accurate. SFSpeechRecognizer follows contextual hints more closely.")
                    }
                }

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

    private var availableEngines: [EngineKind] {
        if #available(iOS 26, *) { return EngineKind.allCases }
        return [.legacy]
    }

    private func labelled(_ title: String, _ hint: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            Text(hint).font(.footnote).foregroundStyle(.secondary)
        }
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }
}

// MARK: - API token

private struct TokenSection: View {
    @ObservedObject var app: AppModel
    @ObservedObject private var settings = SyncSettings.shared
    @State private var draft = ""
    @State private var revealed = false
    @State private var status: Status = .unchecked

    enum Status: Equatable {
        case unchecked, checking, valid(String), invalid(String)
    }

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
            Text("Kikoe uses a read-only personal access token to look up your review items. “Find my token” opens WaniKani's token page and reads the token from it; create one there first if you don't have one. BunPro doesn't need a token.")
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

private enum WaniKaniToken {
    static func check(_ token: String) async -> TokenSection.Status {
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
