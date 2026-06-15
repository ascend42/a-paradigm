// AtriumFooter.swift — #atrium-thread
// A tiny mono status row: model · short session id · in/out tokens · $cost.

import SwiftUI

struct AtriumFooter: View {
    @ObservedObject var session: ClaudeStreamSession

    var body: some View {
        HStack(spacing: 10) {
            label(statusText)
            divider
            label(session.model ?? "—")
            divider
            label("sid:\(shortSession)")
            divider
            label("in \(session.lastUsage?.inputTokens ?? 0) · out \(session.lastUsage?.outputTokens ?? 0)")
            Spacer()
            label(costText)
                .foregroundColor(AtriumTheme.amber)
        }
        .font(AtriumTheme.footerFont)
        .foregroundColor(AtriumTheme.inkMuted)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(AtriumTheme.sunken)
    }

    private var divider: some View {
        Text("·").foregroundColor(AtriumTheme.hairline)
    }

    private func label(_ text: String) -> some View {
        Text(text).lineLimit(1)
    }

    private var shortSession: String {
        guard let sid = session.sessionId else { return "—" }
        return String(sid.prefix(8))
    }

    private var statusText: String {
        switch session.status {
        case .starting: return "starting"
        case .running: return "running"
        case .idle: return "idle"
        case .stopped: return "stopped"
        case .error: return "error"
        }
    }

    private var costText: String {
        guard let cost = session.totalCostUsd else { return "$0.0000" }
        return String(format: "$%.4f", cost)
    }
}
