// AtriumFanOutBlock.swift — #atrium-chorus
// The INLINE FAN-OUT block — surface (1) of THE CHORUS. Born in the conversation
// when the model fans out into sub-agents, it lists the spawned voices grouped by
// subagent_type. While ≥1 is live it shows the live roster; once all settle it
// collapses to a one-line summary ("✓ 4 sub-agents · 2m14s · ▸ expand") that lives
// in history. Same conversation grammar as the rail rows (reused AtriumChorusRow),
// inset so it reads as a single conversational beat — not chrome.

import SwiftUI

struct AtriumFanOutBlock: View {
    let subAgents: [SubAgent]
    /// Shared clock from the thread's TimelineView so timers tick in lockstep.
    let now: Date
    let onStop: (String) -> Void

    @State private var expanded = true
    /// Tracks whether the user has manually toggled, so auto-collapse-on-settle
    /// doesn't fight a manual expand.
    @State private var userToggled = false

    private var liveCount: Int { subAgents.filter { $0.status.isLive }.count }
    private var allSettled: Bool { liveCount == 0 && !subAgents.isEmpty }

    /// Total span from the earliest start to the latest end (or now if still live).
    private var totalElapsed: TimeInterval {
        guard let first = subAgents.map(\.startedAt).min() else { return 0 }
        let last: Date = allSettled
            ? (subAgents.compactMap(\.endedAt).max() ?? now)
            : now
        return max(0, last.timeIntervalSince(first))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            summaryHeader
            if isOpen {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(subAgents) { sub in
                        AtriumChorusRow(
                            sub: sub,
                            now: now,
                            isDrilledIn: false,
                            onToggleDrill: {},
                            onStop: { onStop(sub.id) }
                        )
                    }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AtriumTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(AtriumTheme.hairline, lineWidth: 1)
        )
    }

    /// Open while live (unless the user collapsed it), or when expanded post-settle.
    private var isOpen: Bool {
        if userToggled { return expanded }
        return !allSettled
    }

    private var summaryHeader: some View {
        Button {
            userToggled = true
            withAnimation(.easeOut(duration: 0.18)) { expanded.toggle() }
        } label: {
            HStack(spacing: 8) {
                Text(allSettled ? "✓" : "●")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(allSettled ? AtriumTheme.inkMuted : AtriumTheme.running)
                Text(headline)
                    .font(AtriumTheme.chipFont)
                    .foregroundColor(AtriumTheme.ink)
                Text("·")
                    .foregroundColor(AtriumTheme.hairline)
                Text(AtriumChorusRow.elapsedString(totalElapsed))
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
                Spacer()
                Text(isOpen ? "▾ collapse" : "▸ expand")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var headline: String {
        let n = subAgents.count
        let noun = n == 1 ? "sub-agent" : "sub-agents"
        if liveCount > 0 && liveCount != n {
            return "\(n) \(noun) · \(liveCount) live"
        }
        return "\(n) \(noun)"
    }
}
