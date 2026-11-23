import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
import IOKit.pwr_mgt
#endif

/// The few places iOS and macOS differ, so the views and services above can
/// stay shared between the iOS app and the native macOS app (KikoeMac).
enum Platform {
    static var isMac: Bool {
        #if os(macOS)
        true
        #else
        false
        #endif
    }

    /// Where the user turns microphone and speech access back on.
    static var privacySettingsURL: URL? {
        #if os(iOS)
        URL(string: UIApplication.openSettingsURLString)
        #else
        URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        #endif
    }

    static var privacySettingsName: String {
        isMac ? "System Settings" : "iOS Settings"
    }

    static var didBecomeActive: Notification.Name {
        #if os(iOS)
        UIApplication.didBecomeActiveNotification
        #else
        NSApplication.didBecomeActiveNotification
        #endif
    }

    /// Opens a link outside the app, in the default browser.
    @MainActor
    static func openExternally(_ url: URL) {
        #if os(iOS)
        UIApplication.shared.open(url)
        #else
        NSWorkspace.shared.open(url)
        #endif
    }

    #if os(macOS)
    private static var displaySleepAssertion: IOPMAssertionID?
    #endif

    /// Keeps the display from sleeping during a hands-free review: the iOS
    /// idle timer, or a power assertion on the Mac.
    @MainActor
    static func setKeepAwake(_ on: Bool) {
        #if os(iOS)
        UIApplication.shared.isIdleTimerDisabled = on
        #else
        if on, displaySleepAssertion == nil {
            var id = IOPMAssertionID(0)
            let reason = "Kikoe is listening for review answers" as CFString
            if IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
                                           IOPMAssertionLevel(kIOPMAssertionLevelOn), reason, &id) == kIOReturnSuccess {
                displaySleepAssertion = id
            }
        } else if !on, let id = displaySleepAssertion {
            IOPMAssertionRelease(id)
            displaySleepAssertion = nil
        }
        #endif
    }
}

extension View {
    /// The compact title style for sheets and pushed screens; macOS has no
    /// navigation bar title modes.
    func inlineNavigationTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    /// Tokens, corrections and test phrases are typed exactly as meant.
    func plainTextEntry() -> some View {
        #if os(iOS)
        autocorrectionDisabled().textInputAutocapitalization(.never)
        #else
        autocorrectionDisabled()
        #endif
    }
}

extension Color {
    static var platformBackground: Color {
        #if os(iOS)
        Color(.systemBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }

    static var platformSecondaryBackground: Color {
        #if os(iOS)
        Color(.secondarySystemBackground)
        #else
        Color(nsColor: .controlBackgroundColor)
        #endif
    }
}

extension ToolbarItemPlacement {
    static var barLeading: ToolbarItemPlacement {
        #if os(iOS)
        .topBarLeading
        #else
        .navigation
        #endif
    }

    static var barTrailing: ToolbarItemPlacement {
        #if os(iOS)
        .topBarTrailing
        #else
        .primaryAction
        #endif
    }
}
