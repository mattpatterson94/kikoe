import SwiftUI

enum Site: String, CaseIterable, Identifiable {
    case wanikani
    case bunpro

    var id: String { rawValue }

    var name: String {
        switch self {
        case .wanikani: "WaniKani"
        case .bunpro: "BunPro"
        }
    }

    var home: URL {
        switch self {
        case .wanikani: URL(string: "https://www.wanikani.com/dashboard")!
        case .bunpro: URL(string: "https://bunpro.jp/dashboard")!
        }
    }

    /// Accent for the site switcher. Neither site publishes brand colours
    /// (BunPro's manifest says "white"; WaniKani has none), so these are
    /// picked to read as each site: WaniKani's radical-pink and the
    /// orange-red of BunPro's logo.
    var tint: Color {
        switch self {
        case .wanikani: Color(red: 1.0, green: 0.0, blue: 0.67)
        case .bunpro: Color(red: 0.93, green: 0.36, blue: 0.20)
        }
    }

    static let apiTokenPage = URL(string: "https://www.wanikani.com/settings/personal_access_tokens")!
}

/// Native-only preferences. Everything the web code reads lives in
/// ExtensionStorage instead, so settings.ts sees it unchanged.
enum Pref {
    static let engine = "kikoe.engine"
    static let sendHints = "kikoe.sendHints"
    static let lastSite = "kikoe.lastSite"
    static let developerMode = "kikoe.developerMode"
    static let showDebugBar = "kikoe.dev.showDebugBar"
    static let showSayButton = "kikoe.dev.showSayButton"
}
