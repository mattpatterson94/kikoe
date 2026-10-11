import SwiftUI

/// Listening / muted / problem pill in the nav bar. Tapping it does what
/// tapping the DOM chip does: mute or unmute, or open the token page when
/// the token is what's missing (app.ts decides).
struct IndicatorPill: View {
    let indicator: IndicatorState
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: symbol)
                    .symbolEffect(.pulse, isActive: indicator.state == "listening")
            }
            .fixedSize()
            .font(.footnote.weight(.medium))
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
        return indicator.tone == .muted ? "mic.slash.fill" : "mic.fill"
    }

    private var foreground: Color {
        if indicator.needsAttention { return .white }
        return indicator.tone == .muted ? .secondary : .green
    }

    private var background: Color {
        if indicator.needsAttention { return indicator.attentionColor }
        return indicator.tone == .muted ? Color(.tertiarySystemFill) : Color.green.opacity(0.15)
    }
}

extension IndicatorState {
    /// Errors, plus the ⚠ states app.ts doesn't style as errors (no token,
    /// unsupported card): both need the user to do something.
    var needsAttention: Bool { tone == .error || label.hasPrefix("⚠") }
    var attentionColor: Color { tone == .error ? .red : .orange }
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

/// WaniKani | BunPro, each tinted with its site colour when selected.
struct SiteSwitcher: View {
    @Binding var site: Site
    @Namespace private var selection

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Site.allCases) { option in
                Button {
                    withAnimation(.snappy(duration: 0.25)) { site = option }
                } label: {
                    Text(option.name)
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 5)
                        .foregroundStyle(site == option ? .white : .primary)
                        .background {
                            if site == option {
                                Capsule().fill(option.tint)
                                    .matchedGeometryEffect(id: "selected", in: selection)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(site == option ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Color(.tertiarySystemFill), in: Capsule())
    }
}

/// What the recognizer heard, floating over the page like the DOM chip.
struct TranscriptView: View {
    let bubble: TranscriptBubble
    let onCorrection: (TranscriptBubble.Correction) -> Void

    var body: some View {
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
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .foregroundStyle(bubble.error ? .white : .primary)
        .background {
            if bubble.error {
                Capsule().fill(.red)
            } else {
                Capsule().fill(.regularMaterial)
            }
        }
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)

        if let correction = bubble.correction {
            Button { onCorrection(correction) } label: { content }.buttonStyle(.plain)
        } else {
            content
        }
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
