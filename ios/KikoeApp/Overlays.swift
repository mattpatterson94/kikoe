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
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .foregroundStyle(foreground)
                .background(background, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(indicator.label)
        .accessibilityHint(indicator.state == "no-token" ? "Opens the WaniKani token page" : "Mutes or resumes listening")
    }

    private var symbol: String {
        if indicator.needsAttention { return "exclamationmark.triangle.fill" }
        return indicator.micOn ? "mic.fill" : "mic.slash.fill"
    }

    private var foreground: Color {
        indicator.needsAttention ? .white : indicator.micColor
    }

    private var background: Color {
        indicator.needsAttention ? indicator.attentionColor : indicator.micColor.opacity(0.15)
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

/// Always-on strip above or below the page: a live meter showing the mic is
/// hearing you, then what the recognizer made of it. Stands in for the DOM
/// transcript chip, which comes and goes, so there's a constant sign that
/// listening is working.
struct ListeningBar: View {
    let indicator: IndicatorState?
    let bubble: TranscriptBubble?
    @ObservedObject var level: MicLevel
    /// The language picked from the More menu for this card, if any.
    var languageOverride: String?
    let onMic: () -> Void
    let onCorrection: (TranscriptBubble.Correction) -> Void

    private var live: Bool { indicator?.state == "listening" }
    private var micTint: Color {
        guard let indicator, !indicator.needsAttention else { return .secondary }
        return indicator.micColor
    }

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onMic) {
                HStack(spacing: 6) {
                    Image(systemName: (indicator?.micOn ?? true) ? "mic.fill" : "mic.slash.fill")
                        .font(.body.weight(.semibold))
                    LevelMeter(level: live ? CGFloat(level.value) : 0)
                        .opacity(live ? 1 : 0.4)
                }
                .foregroundStyle(micTint)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(micTint.opacity(0.15), in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(indicator?.micOn == false ? "Resume listening" : "Mute")
            .accessibilityValue(indicator.map { $0.micOn && !$0.needsAttention ? "Listening" : $0.message } ?? "")

            if bubble == nil, let indicator, indicator.needsAttention {
                // The problem itself, tappable like the pill (the token page
                // for a missing token). Replaces the banner while the bar is on.
                Button(action: onMic) {
                    Label(indicator.message, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(indicator.attentionColor)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else if let correction = bubble?.correction {
                Button { onCorrection(correction) } label: { words }
                    .buttonStyle(.plain)
            } else {
                words
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.easeOut(duration: 0.2), value: bubble)
    }

    @ViewBuilder
    private var words: some View {
        if let bubble {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if bubble.error {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                }
                Text(bubble.text)
                    .font(.body.weight(.medium))
                    .foregroundStyle(bubble.error ? .red : .primary)
                if let detail = bubble.detail {
                    Text(detail).font(.callout).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if bubble.correction != nil {
                    Image(systemName: "plus.bubble").foregroundStyle(.tint)
                        .accessibilityLabel("Save as a correction")
                }
            }
            .lineLimit(1)
            .contentShape(Rectangle())
            .id(bubble.id)
            .transition(.opacity)
        } else {
            Text(placeholder)
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .transition(.opacity)
        }
    }

    private var placeholder: String {
        guard let indicator else { return "Kikoe listens during reviews" }
        if indicator.state == "listening" {
            if let lang = languageOverride { return "Listening in \(SpeechLanguage.name(lang)) for this card" }
            return "Listening. Say your answer"
        }
        if indicator.state == "muted" { return "Muted. Tap the mic to listen" }
        return indicator.message
    }
}

/// Four bars that rise with the input level, the middle ones most, like the
/// system's own dictation meter. Flat when the mic is off.
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
