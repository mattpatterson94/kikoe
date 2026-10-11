import SwiftUI

/// Every review site Kikoe can drive. Each case mirrors an adapter that
/// src/site.ts detects; adding an app means a case here and an adapter
/// there. Which ones the user sees is AppModel.enabledSites.
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

    /// One line for onboarding and the Apps settings.
    var blurb: String {
        switch self {
        case .wanikani: "Kanji and vocabulary reviews"
        case .bunpro: "Grammar and vocabulary reviews"
        }
    }

    /// The site's own icon (its apple-touch-icon / favicon), in the asset
    /// catalog. Fine for a personal build; an App Store release would need
    /// the sites' permission to show their marks.
    var iconAsset: String {
        switch self {
        case .wanikani: "SiteWaniKani"
        case .bunpro: "SiteBunPro"
        }
    }

    /// WaniKani's adapter looks answers up through the API; BunPro's reads
    /// them off the page.
    var needsApiToken: Bool { self == .wanikani }

    /// Where a review card lives, for the DEBUG fixture loader.
    var reviewPath: String {
        switch self {
        case .wanikani: "/subjects/review"
        case .bunpro: "/reviews"
        }
    }

    var home: URL {
        switch self {
        case .wanikani: URL(string: "https://www.wanikani.com/dashboard")!
        case .bunpro: URL(string: "https://bunpro.jp/dashboard")!
        }
    }

    /// Accent taken from each site's icon: WaniKani's mask-icon colour
    /// (#1C46F5) and the red of BunPro's favicon.
    var tint: Color {
        switch self {
        case .wanikani: Color(red: 0.11, green: 0.27, blue: 0.96)
        case .bunpro: Color(red: 0.83, green: 0.38, blue: 0.36)
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
    static let enabledSites = "kikoe.enabledSites"
    static let onboarded = "kikoe.onboarded"
    static let developerMode = "kikoe.developerMode"
    static let showDebugBar = "kikoe.dev.showDebugBar"
    static let showSayButton = "kikoe.dev.showSayButton"
}
