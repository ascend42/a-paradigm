// AtriumVisualCanvas.swift — #atrium-visual-canvas
// THE LIGHTBOX. A right slide-out that hosts a single AgentVisual at a time. It
// lives in the SAME right zone as the CHORUS rail and is PUSH-consistent with it
// (the conversation column narrows; the chorus stays mounted UNDER the lightbox).
// Switches on kind: flow → MermaidWebView; comparison → native SwiftUI table
// (ATRIUM styling). v2 kinds (wireframe, diff) show a "coming in v2" placeholder.

import SwiftUI

struct AtriumVisualCanvas: View {
    let visual: AgentVisual
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(AtriumTheme.hairline)
            content
        }
        .frame(width: 380)
        .background(AtriumTheme.surface)
        .overlay(Rectangle().frame(width: 1).foregroundColor(AtriumTheme.hairline), alignment: .leading)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(visual.kind == .comparison ? "▤" : "◇")
                .font(AtriumTheme.chipFont)
                .foregroundColor(AtriumTheme.tool)
            Text(visual.chipLabel)
                .font(AtriumTheme.chipFont)
                .foregroundColor(AtriumTheme.ink)
                .lineLimit(1)
            Spacer()
            Button(action: onClose) {
                Text("✕")
                    .font(AtriumTheme.chipFont)
                    .foregroundColor(AtriumTheme.inkMuted)
            }
            .buttonStyle(.plain)
            .help("Close")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(AtriumTheme.sunken)
    }

    @ViewBuilder
    private var content: some View {
        switch visual.kind {
        case .flow:
            if let mermaid = visual.mermaid, !mermaid.isEmpty {
                MermaidWebView(mermaid: mermaid)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                rawDump
            }
        case .comparison:
            if let table = visual.comparison {
                ComparisonTableView(table: table)
            } else {
                rawDump
            }
        case .wireframe, .diff:
            placeholderV2
        }
    }

    private var rawDump: some View {
        ScrollView {
            Text(visual.raw)
                .font(AtriumTheme.footerFont)
                .foregroundColor(AtriumTheme.inkMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
        }
    }

    private var placeholderV2: some View {
        VStack(spacing: 8) {
            Spacer()
            Text("\(visual.kind.rawValue) visuals are coming in v2")
                .font(AtriumTheme.bodyFont)
                .foregroundColor(AtriumTheme.inkMuted)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Native SwiftUI comparison table (ATRIUM styling) — the kind == .comparison render.
private struct ComparisonTableView: View {
    let table: ComparisonTable

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            VStack(alignment: .leading, spacing: 0) {
                // Header row: leading blank corner + column titles.
                HStack(spacing: 0) {
                    cell("", isHeader: true, leading: true)
                    ForEach(Array(table.columns.enumerated()), id: \.offset) { _, col in
                        cell(col, isHeader: true, leading: false)
                    }
                }
                Divider().overlay(AtriumTheme.hairline)
                // Body rows.
                ForEach(table.rows) { row in
                    HStack(spacing: 0) {
                        cell(row.label, isHeader: false, leading: true)
                        ForEach(Array(row.cells.enumerated()), id: \.offset) { _, c in
                            cell(c, isHeader: false, leading: false)
                        }
                    }
                    Divider().overlay(AtriumTheme.hairline.opacity(0.5))
                }
            }
            .padding(12)
        }
    }

    private func cell(_ text: String, isHeader: Bool, leading: Bool) -> some View {
        Text(text)
            .font(AtriumTheme.chipFont)
            .foregroundColor(isHeader || leading ? AtriumTheme.ink : AtriumTheme.inkMuted)
            .fontWeight(isHeader || leading ? .semibold : .regular)
            .frame(width: 110, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(isHeader ? AtriumTheme.surfaceRaised : Color.clear)
    }
}
