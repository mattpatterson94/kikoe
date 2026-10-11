import SwiftUI

/// App-wide state: which site is showing, the live page sessions, and the
/// settings sheet.
@MainActor
final class AppModel: ObservableObject {
    @Published var site: Site {
        didSet {
            UserDefaults.standard.set(site.rawValue, forKey: Pref.lastSite)
            _ = session(for: site)
        }
    }
    @Published var showSettings = false
    @Published var alert: PageAlert?

    /// Both sites stay loaded once visited, so switching back keeps the
    /// review in progress. If iOS reclaims a background page's process, the
    /// session reloads it when it's next shown.
    private(set) var sessions: [Site: PageSession] = [:]

    init() {
        var initial = UserDefaults.standard.string(forKey: Pref.lastSite).flatMap(Site.init(rawValue:)) ?? .wanikani
        #if DEBUG
        if let env = ProcessInfo.processInfo.environment["KIKOE_SITE"].flatMap(Site.init(rawValue:)) { initial = env }
        #endif
        site = initial
    }

    var current: PageSession { session(for: site) }

    func session(for site: Site) -> PageSession {
        if let existing = sessions[site] { return existing }
        let session = PageSession(site: site, app: self)
        sessions[site] = session
        return session
    }

    /// Opens WaniKani's token page with discovery armed, so content.ts reads
    /// the token off the page and reopens settings (the same flow as the
    /// extension's "Find token" button).
    func findApiToken() {
        ExtensionStorage.set(area: "local", items: [
            "kikoe_api_token_discovery_requested": true,
            "kikoe_api_token_discovery_status": "pending",
        ])
        showSettings = false
        site = .wanikani
        session(for: .wanikani).load(Site.apiTokenPage)
    }

    func presentAlert(message: String, confirm: Bool, completion: @escaping (Bool) -> Void) {
        // One at a time, like Safari: a second dialog while one is up is
        // answered as cancelled.
        if alert != nil { return completion(false) }
        alert = PageAlert(message: message, confirm: confirm, completion: completion)
    }
}

struct PageAlert: Identifiable {
    let id = UUID()
    let message: String
    let confirm: Bool
    let completion: (Bool) -> Void
}

/// The sync storage area as observable state, for the settings screen and
/// the overlays (theme, position). Reads and writes go through
/// ExtensionStorage, so the content script sees every change.
@MainActor
final class SyncSettings: ObservableObject {
    static let shared = SyncSettings()

    @Published private(set) var values: [String: Any] = [:]
    private var observer: NSObjectProtocol?

    private init() {
        Self.migrate()
        values = ExtensionStorage.all(area: "sync")
        observer = NotificationCenter.default.addObserver(
            forName: .kikoeStorageChanged, object: nil, queue: .main
        ) { [weak self] note in
            MainActor.assumeIsolated {
                guard note.userInfo?["area"] as? String == "sync" else { return }
                self?.values = ExtensionStorage.all(area: "sync")
                SpeechService.shared.updateIdleTimer()
            }
        }
    }

    /// Mirrors migrateSettings in extension/content.ts, so settings opened
    /// before any page has run the content script never show (or re-save) a
    /// pre-migration value.
    private static func migrate() {
        let version = ExtensionStorage.value("settings_version", area: "sync") as? Int ?? 0
        guard version < 1 else { return }
        var patch: [String: Any] = ["settings_version": 1]
        // v1: strict kanji readings became the default; flip an old stored false.
        if ExtensionStorage.value("strict_kanji_readings", area: "sync") as? Bool == false {
            patch["strict_kanji_readings"] = true
        }
        ExtensionStorage.set(area: "sync", items: patch)
    }

    /// Mirrors src/settings.ts `defaults`.
    static let defaults: [String: Any] = [
        "debug": false,
        "turbo": true,
        "speed_show_info": true,
        "ippatsu_meaning": false,
        "ippatsu_reading": false,
        "transcript": true,
        "transcript_theme": "system",
        "transcript_position": "top",
        "show_help_button": true,
        "keep_screen_awake": true,
        "strict_kanji_readings": true,
    ]

    func bool(_ key: String) -> Binding<Bool> {
        Binding(
            get: { self.values[key] as? Bool ?? Self.defaults[key] as? Bool ?? false },
            set: { ExtensionStorage.set(area: "sync", items: [key: $0]) })
    }

    func string(_ key: String) -> Binding<String> {
        Binding(
            get: { self.values[key] as? String ?? Self.defaults[key] as? String ?? "" },
            set: { ExtensionStorage.set(area: "sync", items: [key: $0]) })
    }

    var transcriptScheme: ColorScheme? {
        switch values["transcript_theme"] as? String {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }

    var apiToken: String {
        get { values["apiToken"] as? String ?? "" }
        set { ExtensionStorage.set(area: "sync", items: ["apiToken": newValue]) }
    }

    var corrections: [Correction] {
        get {
            (values["customCorrections"] as? [[String: Any]] ?? []).compactMap {
                guard let heard = $0["heard"] as? String, let intended = $0["intended"] as? String else { return nil }
                return Correction(heard: heard, intended: intended)
            }
        }
        set {
            ExtensionStorage.set(area: "sync", items: [
                "customCorrections": newValue.map { ["heard": $0.heard, "intended": $0.intended] },
            ])
        }
    }

    /// Same rules as content.ts addCustomCorrection: trimmed, both sides
    /// required, one entry per heard text (case-insensitive), newest last.
    func saveCorrection(_ correction: Correction, replacing original: Correction? = nil) {
        let heard = correction.heard.trimmingCharacters(in: .whitespacesAndNewlines)
        let intended = correction.intended.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !heard.isEmpty, !intended.isEmpty else { return }
        var list = corrections
        if let original, let index = list.firstIndex(of: original) {
            list[index] = Correction(heard: heard, intended: intended)
            list = list.enumerated().filter { i, pair in
                i == index || pair.heard.lowercased() != heard.lowercased()
            }.map(\.element)
        } else {
            list.removeAll { $0.heard.lowercased() == heard.lowercased() }
            list.append(Correction(heard: heard, intended: intended))
        }
        corrections = list
    }

    struct Correction: Hashable, Identifiable {
        var heard: String
        var intended: String
        var id: String { heard }
    }
}
