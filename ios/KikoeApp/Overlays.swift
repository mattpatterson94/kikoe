import SwiftUI

/// Listening / muted / problem pill in the nav bar: green while the mic is
/// on, red while it's off. Tapping it does what tapping the DOM chip does:
/// mute or unmute, or open the token page when the token is what's missing
/// (app.ts decides).
struct IndicatorPill: View {
    let indicator: IndicatorState
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(indicator.needsAttention ? indicator.attentionColor : indicator.micColor)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(indicator.label)
        .accessibilityHint(indicator.state == "no-token" ? "Opens the WaniKani token page" : "Mutes or resumes listening")
    }

    private var symbol: String {
        if indicator.needsAttention { return "exclamationmark.triangle.fill" }
        return indicator.micOn ? "mic.fill" : "mic.slash.fill"
    }
}

extension IndicatorState {
    /// Errors, plus the ⚠ states app.ts doesn't style as errors (no token,
    /// unsupported card): both need the user to do something.
    var needsAttention: Bool { tone == .error || label.hasPrefix("⚠") }
    var attentionColor: Color { tone == .error ? .red : .orange }
    /// Muted and paused both mean the mic is off.
    var micOn: Bool { tone != .muted && state != "paused" }
    var micColor: Color { micOn ? .green : .red }
    var message: String {
        label.hasPrefix("⚠") ? String(label.dropFirst()).trimmingCharacters(in: .whitespaces) : label
    }
}

/// The words for a problem state, under the nav bar where there's room for
/// them on a phone. Tapping it does what tapping the pill does.
struct IndicatorBanner: View {
    let indicator: IndicatorState
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(indicator.message, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(indicator.attentionColor, in: Capsule())
                .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
        }
        .buttonStyle(.plain)
        .accessibilityHint(indicator.state == "no-token" ? "Opens the WaniKani token page" : "")
    }
}

/// A site's own icon, in the rounded-square shape of a home-screen icon.
struct SiteBadge: View {
    let site: Site
    var size: CGFloat = 22

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.225, style: .continuous)
        Image(site.iconAsset)
            .resizable()
            .interpolation(.high)
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(shape)
            .overlay(shape.strokeBorder(.separator, lineWidth: 0.5))
            .accessibilityHidden(true)
    }
}

/// The nav bar title: the current app, and with more than one app on, a
/// menu to switch between them. Scales to any number of apps without
/// taking room from the page.
struct SiteMenu: View {
    @ObservedObject var app: AppModel

    var body: some View {
        if app.enabledSites.count > 1 {
            Menu {
                Picker("App", selection: $app.site) {
                    ForEach(app.enabledSites) { site in
                        Text(site.name).tag(site)
                    }
                }
                Divider()
                Button { app.showSettings = true } label: {
                    Label("Manage Apps…", systemImage: "square.grid.2x2")
                }
            } label: {
                title(chevron: true)
            }
            .accessibilityLabel("\(app.site.name), switch app")
        } else {
            title(chevron: false)
        }
    }

    private func title(chevron: Bool) -> some View {
        HStack(spacing: 7) {
            SiteBadge(site: app.site)
            Text(app.site.name).font(.headline).foregroundStyle(.primary)
            if chevron {
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
            }
        }
        .fixedSize()
        .contentShape(Rectangle())
    }
}

/// The floating transcript bubble, shown for the whole review rather than
/// only after speech: between answers it says whether Kikoe is listening,
/// with a live level meter so there's a constant sign the mic hears you.
/// Tapping that idle state does what the pill does; tapping a "save as a
/// correction" bubble opens the correction dialog.
struct TranscriptView: View {
    let indicator: IndicatorState
    let bubble: TranscriptBubble?
    @ObservedObject var level: MicLevel
    /// The language picked from the More menu for this card, if any.
    var languageOverride: String?
    let onMic: () -> Void
    let onCorrection: (TranscriptBubble.Correction) -> Void

    var body: some View {
        Group {
            if let bubble {
                heard(bubble).id(bubble.id)
            } else {
                Button(action: onMic) { status }
                    .buttonStyle(.plain)
                    .accessibilityLabel(statusText)
                    .accessibilityHint(indicator.state == "no-token" ? "Opens the WaniKani token page" : "Mutes or resumes listening")
            }
        }
        .transition(.opacity)
        .animation(.easeOut(duration: 0.2), value: bubble)
        .animation(.easeOut(duration: 0.2), value: indicator)
    }

    private func heard(_ bubble: TranscriptBubble) -> some View {
        let content = HStack(alignment: .firstTextBaseline, spacing: 6) {
            if bubble.error { Image(systemName: "exclamationmark.triangle.fill") }
            Text(bubble.text).font(.body.weight(.medium))
            if let detail = bubble.detail {
                Text(detail).font(.callout).foregroundStyle(bubble.error ? .white.opacity(0.8) : .secondary)
            }
            if bubble.correction != nil {
                Image(systemName: "plus.bubble").foregroundStyle(.tint)
                    .accessibilityLabel("Save as a correction")
            }
        }
        .foregroundStyle(bubble.error ? .white : .primary)
        .bubble(fill: bubble.error ? .red : nil)

        return Group {
            if let correction = bubble.correction {
                Button { onCorrection(correction) } label: { content }.buttonStyle(.plain)
            } else {
                content
            }
        }
    }

    private var status: some View {
        HStack(spacing: 8) {
            if indicator.needsAttention {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(indicator.attentionColor)
            } else {
                Image(systemName: indicator.micOn ? "mic.fill" : "mic.slash.fill")
                    .foregroundStyle(indicator.micColor)
                if live {
                    LevelMeter(level: CGFloat(level.value)).foregroundStyle(.secondary)
                }
            }
            Text(statusText).font(.callout).foregroundStyle(.secondary)
        }
        .bubble(fill: nil)
    }

    private var live: Bool { indicator.state == "listening" }

    private var statusText: String {
        if indicator.needsAttention { return indicator.message }
        if live {
            if let lang = languageOverride { return "Listening in \(SpeechLanguage.name(lang))" }
            return "Listening"
        }
        return indicator.micOn ? indicator.message : "Muted"
    }
}

private extension View {
    /// The transcript capsule: frosted, or a solid colour for errors.
    func bubble(fill: Color?) -> some View {
        padding(.horizontal, 14)
            .padding(.vertical, 9)
            .frame(minHeight: 44)
            .background {
                if let fill { Capsule().fill(fill) } else { Capsule().fill(.regularMaterial) }
            }
            .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
            .contentShape(Capsule())
    }
}

/// Four bars that rise with the input level, the middle ones most, like the
/// system's own dictation meter.
struct LevelMeter: View {
    let level: CGFloat
    private let weights: [CGFloat] = [0.55, 1, 0.8, 0.45]

    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(weights.indices, id: \.self) { i in
                Capsule()
                    .frame(width: 3, height: 4 + 14 * level * weights[i])
            }
        }
        .frame(height: 18)
        .accessibilityHidden(true)
    }
}

struct HintToast: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "questionmark.circle")
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.thinMaterial, in: Capsule())
            .shadow(color: .black.opacity(0.1), radius: 6, y: 2)
    }
}

/// The voice-command cheat sheet. app.ts pauses listening while it's open
/// and resumes when it's dismissed.
struct HelpSheet: View {
    let help: HelpContent
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(help.commands, id: \.self) { command in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(command.phrases).font(.body.weight(.semibold))
                            Text(command.description).font(.subheadline).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text("Say")
                } footer: {
                    Text("The mic is paused while this is open · listening in \(help.language)")
                }
                if !help.tips.isEmpty {
                    Section("Tips") {
                        ForEach(help.tips, id: \.self) { Text($0).font(.subheadline) }
                    }
                }
                if let url = help.guideURL {
                    Section { Link("Full guide", destination: url) }
                }
            }
            .navigationTitle("Voice commands")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", action: onClose) }
            }
        }
    }
}
