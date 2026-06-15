// AtriumMessageView.swift — #atrium-thread
// Renders a single ConversationMessage. Agent turns are full-width ink text with
// a blinking amber caret while streaming and tool chips below. User turns are
// right-aligned capsules.

import SwiftUI

struct AtriumMessageView: View {
    let message: ConversationMessage

    var body: some View {
        switch message.author {
        case .agent:
            agentView
        case .user:
            userView
        case .system:
            systemView
        }
    }

    // MARK: - Agent

    private var agentView: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !message.text.isEmpty || message.isStreaming {
                HStack(alignment: .bottom, spacing: 0) {
                    Text(Self.markdown(message.text))
                        .font(AtriumTheme.bodyFont)
                        .foregroundColor(AtriumTheme.ink)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    if message.isStreaming {
                        BlinkingCaret()
                    }
                }
            }

            if !message.toolCalls.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(message.toolCalls) { call in
                        AtriumToolChip(call: call)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - User

    private var userView: some View {
        HStack {
            Spacer(minLength: 40)
            Text(message.text)
                .font(AtriumTheme.bodyFont)
                .foregroundColor(AtriumTheme.user)
                .textSelection(.enabled)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(AtriumTheme.surfaceRaised)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(AtriumTheme.user.opacity(0.3), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: - Markdown

    /// Render agent text as inline markdown (bold, italics, code spans, links)
    /// while preserving the original line breaks. Code spans are recolored to the
    /// ATRIUM amber accent; the body already uses a monospaced font so spans read
    /// as inline code. Falls back to plain text if parsing fails.
    static func markdown(_ raw: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            allowsExtendedAttributes: true,
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        guard var attributed = try? AttributedString(markdown: raw, options: options) else {
            return AttributedString(raw)
        }
        // Tint inline code spans with the amber accent for visual contrast.
        for run in attributed.runs where run.inlinePresentationIntent?.contains(.code) == true {
            attributed[run.range].foregroundColor = AtriumTheme.amber
        }
        return attributed
    }

    // MARK: - System

    private var systemView: some View {
        Text(message.text)
            .font(AtriumTheme.footerFont)
            .foregroundColor(AtriumTheme.inkMuted)
            .frame(maxWidth: .infinity, alignment: .center)
    }
}

/// A blinking amber block caret (▍) shown at the tail of a streaming agent turn.
private struct BlinkingCaret: View {
    @State private var on = true

    var body: some View {
        Text("▍")
            .font(AtriumTheme.bodyFont)
            .foregroundColor(AtriumTheme.amber)
            .opacity(on ? 1 : 0)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                    on = false
                }
            }
    }
}
