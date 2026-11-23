import UIKit

/// Where the user fixes denied microphone / speech access, which differs
/// between iPhone/iPad (the app's Settings page) and the Mac (System Settings).
enum SystemSettings {
    #if targetEnvironment(macCatalyst)
    static let name = "System Settings"
    static let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
    #else
    static let name = "iOS Settings"
    static let url = URL(string: UIApplication.openSettingsURLString)
    #endif
}
