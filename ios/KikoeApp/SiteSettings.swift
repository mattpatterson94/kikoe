import Foundation

/// Settings that can differ between WaniKani and BunPro.
///
/// An override is stored in the same sync area as `<site>:<key>`, e.g.
/// `bunpro:transcript_position`. Where there isn't one, the plain key
/// applies, so everything set before this existed keeps working for both.
/// The web code never sees the prefixes: each page is handed its own site's
/// values under the plain keys (see `apply` and `relay`).
enum SiteSettings {
    static let keys: Set<String> = [
        "turbo", "speed_show_info", "ippatsu_meaning", "ippatsu_reading",
        "transcript", "transcript_theme", "transcript_position", "show_help_button",
        "strict_kanji_readings",
    ]

    static func key(_ key: String, _ site: Site) -> String { "\(site.rawValue):\(key)" }

    /// `<site>:<key>` split into its parts, or nil for any other key.
    static func split(_ key: String) -> (site: Site, base: String)? {
        guard let colon = key.firstIndex(of: ":"),
              let site = Site(rawValue: String(key[..<colon])) else { return nil }
        return (site, String(key[key.index(after: colon)...]))
    }

    /// The names a chrome.storage.get call asks for; nil means everything.
    static func requestedNames(_ keys: Any?) -> [String]? {
        switch keys {
        case let k as String: return [k]
        case let ks as [String]: return ks
        case let defaults as [String: Any]: return Array(defaults.keys)
        default: return nil
        }
    }

    /// A storage.get result as `site`'s page should see it: its overrides
    /// laid over the plain keys, and nobody's prefixed keys left in.
    static func apply(to result: [String: Any], requested: Any?, stored: [String: Any], for site: Site) -> [String: Any] {
        var out = result.filter { split($0.key) == nil }
        let names = requestedNames(requested)
        for name in keys where names?.contains(name) ?? true {
            if let override = stored[key(name, site)] { out[name] = override }
        }
        return out
    }

    /// chrome.storage.onChanged changes as `site`'s page should see them: its
    /// own overrides become changes to the plain key, other sites' are
    /// dropped, and a plain key it overrides is left alone.
    static func relay(_ changes: [String: Any], stored: [String: Any], for site: Site) -> [String: Any] {
        var out: [String: Any] = [:]
        for (name, change) in changes {
            if let (owner, base) = split(name) {
                guard owner == site else { continue }
                if let change = change as? [String: Any], change["newValue"] != nil {
                    out[base] = change
                } else if let fallback = stored[base] {
                    // The override was removed: back to the plain setting.
                    out[base] = ["newValue": fallback]
                }
            } else if keys.contains(name), stored[key(name, site)] != nil {
                continue
            } else {
                out[name] = change
            }
        }
        return out
    }
}
