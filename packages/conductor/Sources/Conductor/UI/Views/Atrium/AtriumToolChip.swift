// AtriumToolChip.swift — #atrium-thread
// A collapsible chip representing a single tool call within an agent message.
// Collapsed: "▸ name  inputSummary" + state glyph. Expanded: result in a sunken pane.

import SwiftUI

struct AtriumToolChip: View {
    let call: ToolCall
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                expanded.toggle()
            } label: {
                HStack(spacing: 6) {
                    Text(expanded ? "▾" : "▸")
                        .foregroundColor(AtriumTheme.tool)
                    Text(call.name)
                        .foregroundColor(AtriumTheme.tool)
                        .fontWeight(.semibold)
                    Text(call.inputSummary)
                        .foregroundColor(AtriumTheme.inkMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 6)
                    stateGlyph
                }
                .font(AtriumTheme.chipFont)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
            }
            .buttonStyle(.plain)
            .background(AtriumTheme.surfaceRaised)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(AtriumTheme.tool.opacity(0.35), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 6))

            if expanded, let result = call.resultSummary, !result.isEmpty {
                Text(result)
                    .font(AtriumTheme.chipFont)
                    .foregroundColor(AtriumTheme.inkMuted)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(AtriumTheme.sunken)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    @ViewBuilder
    private var stateGlyph: some View {
        switch call.state {
        case .running:
            ProgressView()
                .controlSize(.mini)
                .tint(AtriumTheme.tool)
        case .succeeded:
            Text("✓").foregroundColor(AtriumTheme.running)
        case .failed:
            Text("✕").foregroundColor(AtriumTheme.blocked)
        }
    }
}
