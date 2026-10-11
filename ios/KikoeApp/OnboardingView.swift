import AVFoundation
import Speech
import SwiftUI

/// First launch: what Kikoe does, which apps to turn on, microphone and
/// speech permission (asked here, with a reason, rather than over a review
/// card), and the WaniKani token when WaniKani is on.
struct OnboardingView: View {
    @ObservedObject var app: AppModel

    enum Step: Int, CaseIterable { case welcome, apps, permission, token, ready }

    @State private var step: Step = .welcome
    @State private var sites: Set<Site> = Set(Site.allCases)
    @State private var permission: PermissionState = .current
    @State private var findTokenAfter = true

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                content
                    .frame(maxWidth: 520)
                    .padding(.horizontal, 28)
                    .padding(.top, 48)
                    .frame(maxWidth: .infinity)
                    .id(step)
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .move(edge: .leading).combined(with: .opacity)))
            }
            .scrollBounceBehavior(.basedOnSize)
            footer
        }
        .background(Color("LaunchBackground").ignoresSafeArea())
        .overlay(alignment: .topLeading) {
            if step != .welcome {
                Button { go(back: true) } label: {
                    Image(systemName: "chevron.left").font(.title3.weight(.semibold))
                        .padding(12)
                }
                .accessibilityLabel("Back")
                .padding(.leading, 8)
            }
        }
    }

    // MARK: Steps

    @ViewBuilder
    private var content: some View {
        switch step {
        case .welcome: welcome
        case .apps: apps
        case .permission: permissionStep
        case .token: TokenStep(app: app, findTokenAfter: $findTokenAfter)
        case .ready: ready
        }
    }

    private var welcome: some View {
        VStack(spacing: 28) {
            Image("LaunchLogo").resizable().scaledToFit().frame(width: 150, height: 150)
            VStack(spacing: 8) {
                Text("Kikoe").font(.largeTitle.weight(.bold))
                Text("Answer your Japanese reviews out loud.")
                    .font(.title3).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            VStack(alignment: .leading, spacing: 20) {
                feature("mic.fill", "Just say the answer",
                        "Japanese for readings, English for meanings. Kikoe switches for each card.")
                feature("hand.raised.fill", "Hands-free",
                        "Say “next”, “wrong”, “info” or “help” instead of tapping.")
                feature("person.crop.circle", "Your own account",
                        "Reviews happen on the real sites, signed in as you.")
            }
            .padding(.top, 8)
        }
    }

    private var apps: some View {
        VStack(alignment: .leading, spacing: 20) {
            header("Which apps do you use?", "You can change this any time in Settings.")
            VStack(spacing: 12) {
                ForEach(Site.allCases) { site in
                    let on = sites.contains(site)
                    Button {
                        withAnimation(.snappy) {
                            if on { sites.remove(site) } else { sites.insert(site) }
                        }
                    } label: {
                        HStack(spacing: 14) {
                            SiteBadge(site: site, size: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(site.name).font(.headline)
                                Text(site.blurb).font(.subheadline).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                .font(.title2)
                                .foregroundStyle(on ? site.tint : .secondary)
                        }
                        .padding(14)
                        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .strokeBorder(on ? site.tint : .clear, lineWidth: 2)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
    }

    private var permissionStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            header("Kikoe needs to hear you",
                   "It listens only while a review card is showing, and stops when you leave the page or say “pause”.")
            VStack(alignment: .leading, spacing: 16) {
                feature("mic.fill", "Microphone", "To hear your answers.")
                feature("waveform", "Speech recognition",
                        "To turn what you say into text. Where your device supports it, this happens on the device.")
            }
            switch permission {
            case .granted:
                Label("You're all set", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green).font(.headline)
            case .denied:
                VStack(alignment: .leading, spacing: 8) {
                    Label("Access is turned off", systemImage: "mic.slash.fill")
                        .foregroundStyle(.orange).font(.headline)
                    Text("Kikoe can't listen without it. Turn on Microphone and Speech Recognition for Kikoe in iOS Settings.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        Link("Open iOS Settings", destination: url).font(.subheadline.weight(.semibold))
                    }
                }
            case .undetermined:
                EmptyView()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            permission = .current
        }
    }

    private var ready: some View {
        VStack(alignment: .leading, spacing: 20) {
            header("Ready to review", "Open your reviews and Kikoe starts listening.")
            VStack(alignment: .leading, spacing: 18) {
                feature("text.bubble.fill", "Say the answer",
                        "A correct answer is submitted on its own. Say “next” to move on if Turbo is off.")
                feature("questionmark.circle.fill", "Say “help”",
                        "Shows every voice command that works on the current card.")
                feature("mic.slash.fill", "Tap the mic to pause",
                        "The mic button at the top left mutes and resumes listening.")
                if sites.count > 1 {
                    feature("chevron.down.circle.fill", "Switch apps from the title",
                            "Tap the app name at the top to move between your apps. Each keeps its place.")
                }
            }
            if !sites.contains(.wanikani) || willFindToken {
                Text(signInNote).font(.subheadline).foregroundStyle(.secondary).padding(.top, 4)
            }
        }
    }

    private var signInNote: String {
        if willFindToken { return "Sign in to WaniKani on the next screen. Kikoe picks your token up from the token page." }
        return "Sign in to \(ordered.map(\.name).joined(separator: " and ")) on the next screen if you aren't already."
    }

    // MARK: Footer

    private var footer: some View {
        VStack(spacing: 10) {
            Button(action: primary) {
                Text(primaryTitle)
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(step == .apps && sites.isEmpty)

            if step == .permission && permission == .undetermined {
                Button("Not now") { go() }.font(.subheadline)
            }
            if step == .apps && sites.isEmpty {
                Text("Choose at least one").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: 520)
        .padding(.horizontal, 28)
        .padding(.bottom, 16)
        .padding(.top, 8)
    }

    private var primaryTitle: String {
        switch step {
        case .welcome: "Get started"
        case .permission where permission == .undetermined: "Allow access"
        case .ready: "Start reviewing"
        default: "Continue"
        }
    }

    private func primary() {
        switch step {
        case .permission where permission == .undetermined:
            Task {
                _ = await SpeechPermissions.request()
                permission = .current
                if permission == .granted { go() }
            }
        case .ready:
            app.finishOnboarding(sites: sites)
            if willFindToken { app.findApiToken() }
        default:
            go()
        }
    }

    // MARK: Navigation

    /// The steps that apply: the token step only with WaniKani on.
    private var steps: [Step] {
        Step.allCases.filter { step in
            switch step {
            case .token: sites.contains(.wanikani)
            default: true
            }
        }
    }

    private var willFindToken: Bool { findTokenAfter && sites.contains(.wanikani) }

    private var ordered: [Site] { Site.allCases.filter(sites.contains) }

    private func go(back: Bool = false) {
        guard let index = steps.firstIndex(of: step) else { return }
        let next = index + (back ? -1 : 1)
        guard steps.indices.contains(next) else { return }
        withAnimation(.snappy(duration: 0.35)) { step = steps[next] }
    }

    // MARK: Pieces

    private func header(_ title: String, _ subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.largeTitle.weight(.bold))
            Text(subtitle).font(.body).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func feature(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

enum PermissionState {
    case undetermined, granted, denied

    static var current: PermissionState {
        let mic = AVAudioApplication.shared.recordPermission
        let speech = SFSpeechRecognizer.authorizationStatus()
        if mic == .denied || speech == .denied || speech == .restricted { return .denied }
        if mic == .granted && speech == .authorized { return .granted }
        return .undetermined
    }
}

/// Paste a token, or have Kikoe find it once the user is signed in.
private struct TokenStep: View {
    @ObservedObject var app: AppModel
    @Binding var findTokenAfter: Bool
    @ObservedObject private var settings = SyncSettings.shared
    @State private var draft = ""
    @State private var status: WaniKaniToken.Status = .unchecked

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
                SiteBadge(site: .wanikani, size: 36)
                Text("WaniKani").font(.title3.weight(.semibold))
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Connect WaniKani").font(.largeTitle.weight(.bold))
                Text("Kikoe looks up the accepted answers for each review with a read-only API token. It never changes anything on your account.")
                    .foregroundStyle(.secondary)
            }

            Button {
                findTokenAfter.toggle()
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: findTokenAfter ? "checkmark.circle.fill" : "circle")
                        .font(.title2).foregroundStyle(findTokenAfter ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Find it for me").font(.headline)
                        Text("After setup, Kikoe opens WaniKani's token page. Sign in, and it reads the token from the page. If you don't have one yet, create one there with the default read-only permissions.")
                            .font(.subheadline).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isValid)

            VStack(alignment: .leading, spacing: 8) {
                Text("Or paste a token").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                SecureField("Personal access token", text: $draft)
                    .font(draft.isEmpty ? .body : .body.monospaced())
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(12)
                    .background(.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .onSubmit { Task { await check() } }
                statusRow.font(.subheadline)
            }

            Text("You can skip this and add it later in Settings.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .onAppear {
            draft = settings.apiToken
            if !draft.isEmpty { Task { await check() } }
        }
        .onChange(of: draft) {
            status = .unchecked
            let token = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            // Personal access tokens are UUIDs; check once one looks complete.
            if token.count == 36 { Task { await check() } }
        }
    }

    private var isValid: Bool {
        if case .valid = status { return true }
        return false
    }

    @ViewBuilder
    private var statusRow: some View {
        switch status {
        case .unchecked:
            EmptyView()
        case .checking:
            HStack { ProgressView(); Text("Checking…").foregroundStyle(.secondary) }
        case let .valid(user):
            Label("Connected as \(user)", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        case let .invalid(reason):
            Label(reason, systemImage: "xmark.circle.fill").foregroundStyle(.red)
        }
    }

    private func check() async {
        let token = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return }
        status = .checking
        status = await WaniKaniToken.check(token)
        if case .valid = status {
            settings.apiToken = token
            findTokenAfter = false
        }
    }
}
