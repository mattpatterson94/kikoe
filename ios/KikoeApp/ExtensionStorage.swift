import Foundation
import Security

extension Notification.Name {
    /// Posted after every write, with `area` and chrome.storage.onChanged-
    /// shaped `changes` in userInfo. Each page session relays it to its
    /// content script; the native settings screen refreshes from it.
    static let kikoeStorageChanged = Notification.Name("KikoeStorageChanged")
}

/// chrome.storage.{sync,local} for the content script and the native
/// settings screen: one JSON file per area under Application Support.
///
/// Files rather than UserDefaults because the local area holds the WaniKani
/// subject cache, which outgrows what UserDefaults is meant for. The first
/// read of an area migrates the blob the spike kept in UserDefaults.
///
/// The WaniKani API token is the one secret, so it lives in the Keychain
/// instead of the file. Callers can't tell: it's merged into reads and
/// split out of writes, under the same key.
@MainActor
enum ExtensionStorage {
    static let areas = ["sync", "local"]
    private static var cache: [String: [String: Any]] = [:]
    private static let secretKeys = ["apiToken"]
    /// What the Keychain holds, to skip rewriting an unchanged secret.
    private static var secrets: [String: String] = [:]

    private static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("ExtensionStorage", isDirectory: true)
    }

    private static func fileURL(_ area: String) -> URL {
        directory.appendingPathComponent("\(area).json")
    }

    private static func legacyDefaultsKey(_ area: String) -> String { "kikoe.storage.\(area)" }

    static func all(area: String) -> [String: Any] {
        guard areas.contains(area) else { return [:] }
        if let cached = cache[area] { return cached }
        var stored: [String: Any] = [:]
        if let data = try? Data(contentsOf: fileURL(area)),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            stored = obj
        } else if let legacy = UserDefaults.standard.string(forKey: legacyDefaultsKey(area)),
                  let obj = try? JSONSerialization.jsonObject(with: Data(legacy.utf8)) as? [String: Any] {
            stored = obj
            save(obj, area: area)
            UserDefaults.standard.removeObject(forKey: legacyDefaultsKey(area))
        }
        if area == "sync" {
            // A token still in the file predates the Keychain: move it.
            let inFile = secretKeys.filter { stored[$0] != nil }
            for key in secretKeys {
                if let value = Keychain.read(key) {
                    secrets[key] = value
                    if stored[key] == nil { stored[key] = value }
                }
            }
            if !inFile.isEmpty { save(stored, area: area) }
        }
        cache[area] = stored
        return stored
    }

    private static func save(_ dict: [String: Any], area: String) {
        cache[area] = dict
        var file = dict
        if area == "sync" {
            for key in secretKeys {
                let value = (file.removeValue(forKey: key) as? String) ?? ""
                guard value != (secrets[key] ?? "") else { continue }
                if value.isEmpty { Keychain.delete(key) } else { Keychain.write(key, value) }
                secrets[key] = value
            }
        }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: file)
            try data.write(to: fileURL(area), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            NSLog("[kikoe] failed to save \(area) storage: \(error)")
        }
    }

    /// `keys` follows chrome.storage.get: null (everything), a key, an array
    /// of keys, or an object of key → default.
    static func get(area: String, keys: Any?) -> [String: Any] {
        let stored = all(area: area)
        switch keys {
        case nil, is NSNull:
            return stored
        case let k as String:
            return stored[k].map { [k: $0] } ?? [:]
        case let ks as [String]:
            return stored.filter { ks.contains($0.key) }
        case let defaults as [String: Any]:
            return defaults.merging(stored.filter { defaults.keys.contains($0.key) }) { _, new in new }
        default:
            return [:]
        }
    }

    static func value(_ key: String, area: String = "sync") -> Any? {
        all(area: area)[key]
    }

    static func set(area: String, items: [String: Any]) {
        guard areas.contains(area), !items.isEmpty else { return }
        var stored = all(area: area)
        var changes: [String: Any] = [:]
        for (k, v) in items {
            var change: [String: Any] = ["newValue": v]
            if let old = stored[k] { change["oldValue"] = old }
            changes[k] = change
            stored[k] = v
        }
        save(stored, area: area)
        notify(changes, area: area)
    }

    static func remove(area: String, keys: Any?) {
        guard areas.contains(area) else { return }
        var stored = all(area: area)
        let ks: [String] = (keys as? [String]) ?? ((keys as? String).map { [$0] } ?? [])
        var changes: [String: Any] = [:]
        for k in ks {
            if let old = stored.removeValue(forKey: k) { changes[k] = ["oldValue": old] }
        }
        guard !changes.isEmpty else { return }
        save(stored, area: area)
        notify(changes, area: area)
    }

    private static func notify(_ changes: [String: Any], area: String) {
        NotificationCenter.default.post(name: .kikoeStorageChanged, object: nil,
                                        userInfo: ["area": area, "changes": changes])
    }
}

/// Generic-password items for this app, readable after the first unlock so
/// a page restored in the background can still look subjects up.
private enum Keychain {
    private static let service = "com.mattdoesdev.kikoe.storage"

    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    static func read(_ account: String) -> String? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ account: String, _ value: String) {
        let data = Data(value.utf8)
        let status = SecItemUpdate(query(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        guard status == errSecItemNotFound else {
            if status != errSecSuccess { NSLog("[kikoe] keychain update failed: \(status)") }
            return
        }
        var add = query(account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(add as CFDictionary, nil)
        if added != errSecSuccess { NSLog("[kikoe] keychain add failed: \(added)") }
    }

    static func delete(_ account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }
}
