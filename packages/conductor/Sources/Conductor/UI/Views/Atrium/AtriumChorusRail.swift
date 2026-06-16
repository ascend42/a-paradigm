// AtriumChorusRail.swift — #atrium-chorus
// THE CHORUS — sub-agents as a chorus of parallel voices in the session. This file
// holds the right-side CHORUS RAIL (auto-appears while ≥1 sub-agent is live, slides
// away when all idle, pinnable to stay open), the shared sub-agent ROW anatomy, the
// heartbeat SPARKLINE, and the limited v1 DRILL-IN. Built for the eventual
// full-screen Conductor (Claude-desktop-app style), not the tiny floating window.
//
// Temperature law (founder-baked): running = teal (#4ED7A0, autonomous work needs
// NO attention — never amber), completed/killed/stopped = inkMuted (settled),
// failed = coral (#FF6B6B), amber (#F2B765) ONLY for needsHuman (blocked on the
// founder). Blue (#7CC4FF) left-edge = keyboard/selection focus.
//
// parent_tool_use_id is ABSENT in the CLI stream (verified) → v1 drill-in shows the
// sub-agent's description + subagent_type + live last-activity + status + elapsed.
// Full nested transcript is flagged v2 (we do NOT fake it).

import SwiftUI

// MARK: - Chorus state colors (temperature law)

extension SubAgentStatus {
    /// The temperature color for this state (THE CHORUS law). Reads from the SHARED
    /// TemperatureLaw (SessionDerivedStatus.swift) so the chorus and the session
    /// spine always agree on what teal/amber/coral/muted mean.
    var chorusColor: Color {
        switch self {
        case .running: return TemperatureLaw.working   // teal — autonomous, no attention
        case .completed, .killed, .stopped: return TemperatureLaw.settled // settled, quiet
        case .failed: return TemperatureLaw.error      // coral
        case .needsHuman: return TemperatureLaw.attention // the ONLY amber state
        }
    }

    /// State glyph leading the row.
    var glyph: String {
        switch self {
        case .running: return "●"
        case .completed: return "✓"
        case .killed, .stopped: return "◼"
        case .failed: return "✕"
        case .needsHuman: return "！"
        }
    }

    var label: String {
        switch self {
        case .running: return "running"
        case .completed: return "done"
        case .killed: return "killed"
        case .stopped: return "stopped"
        case .failed: return "failed"
        case .needsHuman: return "needs you"
        }
    }
}

// MARK: - CHORUS RAIL

/// The right-side rail. Founder decisions: auto-appears when ≥1 sub-agent is
/// running, slides away when all idle, PINNABLE (a pin keeps it open when idle).
/// PUSH layout — the parent narrows the conversation column to make room (no
/// overlay); see AtriumThreadView. 220ms ease in/out is applied at the parent's
/// reflow site. This view is the rail's content; visibility is the parent's call.
struct AtriumChorusRail: View {
    @ObservedObject var session: ClaudeStreamSession
    /// Pin binding owned by the parent so the rail can stay open when idle.
    @Binding var pinned: Bool
    /// Currently drilled-in sub-agent id, if any (expands IN PLACE).
    @State private var drilledIn: String?

    /// Fixed rail width — generous for the full-screen target.
    static let width: CGFloat = 300

    private var liveCount: Int { session.subAgents.filter { $0.status.isLive }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(AtriumTheme.hairline)
            if session.subAgents.isEmpty {
                emptyState
            } else {
                // One shared clock for the whole rail so every elapsed timer +
                // sparkline ticks in lockstep (1s cadence — the rail is glanceable,
                // not a stopwatch).
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 6) {
                            ForEach(session.subAgents) { sub in
                                AtriumChorusRow(
                                    sub: sub,
                                    now: context.date,
                                    isDrilledIn: drilledIn == sub.id,
                                    onToggleDrill: { toggleDrill(sub.id) },
                                    onStop: { session.stopSubAgent(id: sub.id) }
                                )
                            }
                        }
                        .padding(10)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(width: Self.width)
        .background(AtriumTheme.surface)
        .overlay(alignment: .leading) {
            Rectangle().fill(AtriumTheme.hairline).frame(width: 1)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("CHORUS")
                .font(AtriumTheme.footerFont)
                .foregroundColor(AtriumTheme.inkMuted)
            if liveCount > 0 {
                Text("\(liveCount) live")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.running)
            }
            Spacer()
            // Pin control — keeps the rail open when idle.
            Button(action: { pinned.toggle() }) {
                Image(systemName: pinned ? "pin.fill" : "pin")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(pinned ? AtriumTheme.user : AtriumTheme.inkMuted)
            }
            .buttonStyle(.plain)
            .help(pinned ? "Unpin — rail auto-hides when no sub-agents are running" : "Pin — keep the chorus rail open")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(AtriumTheme.sunken)
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Image(systemName: "person.3.sequence")
                .font(.system(size: 18, weight: .light))
                .foregroundColor(AtriumTheme.hairline)
            Text("No sub-agents")
                .font(AtriumTheme.chipFont)
                .foregroundColor(AtriumTheme.inkMuted)
            Text("When the model fans out into parallel sub-agents, their voices appear here.")
                .font(AtriumTheme.footerFont)
                .foregroundColor(AtriumTheme.hairline)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .padding(.horizontal, 14)
    }

    private func toggleDrill(_ id: String) {
        withAnimation(.easeOut(duration: 0.18)) {
            drilledIn = (drilledIn == id) ? nil : id
        }
    }
}

// MARK: - CHORUS ROW (shared anatomy)

/// One sub-agent row — prose over mechanics.
/// [state glyph] + DESCRIPTION (ink, leads) + subagent_type (mono, muted subtitle)
/// + heartbeat SPARKLINE + elapsed (mono, right). Drill-in expands IN PLACE.
struct AtriumChorusRow: View {
    let sub: SubAgent
    let now: Date
    let isDrilledIn: Bool
    let onToggleDrill: () -> Void
    let onStop: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onToggleDrill) {
                rowBody
            }
            .buttonStyle(.plain)

            if isDrilledIn {
                drillIn
            }
        }
        .background(AtriumTheme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            // Blue left-edge = focus (drilled-in). Subtle state-tinted border otherwise.
            RoundedRectangle(cornerRadius: 8)
                .stroke(isDrilledIn ? AtriumTheme.user : sub.status.chorusColor.opacity(0.25), lineWidth: 1)
        )
        .overlay(alignment: .leading) {
            if isDrilledIn {
                RoundedRectangle(cornerRadius: 2)
                    .fill(AtriumTheme.user)
                    .frame(width: 3)
                    .padding(.vertical, 4)
            }
        }
    }

    private var rowBody: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .top, spacing: 7) {
                Text(sub.status.glyph)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(sub.status.chorusColor)
                    .frame(width: 12)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 2) {
                    // DESCRIPTION leads — prose, ink, system font (Inter-ish).
                    Text(sub.description)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(AtriumTheme.ink)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if let type = sub.subagentType {
                        Text(type)
                            .font(AtriumTheme.footerFont)
                            .foregroundColor(AtriumTheme.inkMuted)
                    }
                }
                Spacer(minLength: 4)
                Text(Self.elapsedString(sub.elapsed(now: now)))
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
                    .padding(.top, 1)
            }
            // Heartbeat sparkline (running) or settled status label + usage.
            HStack(spacing: 6) {
                if sub.status == .running {
                    Sparkline(ticks: sub.progressTicks, now: now, color: sub.status.chorusColor)
                        .frame(height: 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    // Settled: glyph-tinted status + real usage when present
                    // ("done · 12.2k tok · 1.4s"). Usage from task_notification.
                    Text(sub.status.label)
                        .font(AtriumTheme.footerFont)
                        .foregroundColor(sub.status.chorusColor)
                    if let usage = sub.usageSummary {
                        Text("· \(usage)")
                            .font(AtriumTheme.footerFont)
                            .foregroundColor(AtriumTheme.inkMuted)
                    }
                    Spacer()
                }
            }
            .padding(.leading, 19)
        }
        .padding(9)
        .contentShape(Rectangle())
    }

    // MARK: Drill-in (v1 — limited; full nested transcript flagged v2)

    private var drillIn: some View {
        VStack(alignment: .leading, spacing: 6) {
            Divider().overlay(AtriumTheme.hairline)
            detailRow("type", sub.subagentType ?? "—")
            detailRow("status", sub.status.label, tint: sub.status.chorusColor)
            detailRow("elapsed", Self.elapsedString(sub.elapsed(now: now)))
            // Real usage from the terminal task_notification (#sub-agent).
            if let tokens = sub.totalTokens {
                detailRow("tokens", SubAgent.compactTokens(tokens))
            }
            if let tools = sub.toolUses {
                detailRow("tool uses", "\(tools)")
            }
            if let ms = sub.durationMs {
                detailRow("duration", SubAgent.compactDuration(ms))
            }
            if let prompt = sub.prompt, !prompt.isEmpty {
                Text("prompt")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
                Text(prompt)
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.ink)
                    .lineLimit(6)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                    .background(AtriumTheme.sunken)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }
            if let activity = sub.lastActivity, !activity.isEmpty {
                Text("last activity")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
                Text(activity)
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.ink)
                    .lineLimit(4)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                    .background(AtriumTheme.sunken)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }
            // v2 honesty note — we do NOT fake a nested transcript.
            Text("Nested transcript coming soon — the stream doesn't yet attribute sub-agent tool calls.")
                .font(AtriumTheme.footerFont)
                .foregroundColor(AtriumTheme.hairline)
                .italic()
            HStack(spacing: 8) {
                if sub.status == .running {
                    Button(action: onStop) {
                        Text("Stop")
                            .font(AtriumTheme.chipFont)
                            .foregroundColor(AtriumTheme.blocked)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(AtriumTheme.blocked.opacity(0.6), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                Text("⎋ collapse")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
            }
        }
        .padding(9)
    }

    private func detailRow(_ key: String, _ value: String, tint: Color = AtriumTheme.ink) -> some View {
        HStack(spacing: 6) {
            Text(key)
                .font(AtriumTheme.footerFont)
                .foregroundColor(AtriumTheme.inkMuted)
                .frame(width: 54, alignment: .leading)
            Text(value)
                .font(AtriumTheme.footerFont)
                .foregroundColor(tint)
            Spacer()
        }
    }

    /// "1m14s" / "42s" — compact mono elapsed.
    static func elapsedString(_ t: TimeInterval) -> String {
        let total = Int(t)
        let m = total / 60
        let s = total % 60
        return m > 0 ? "\(m)m\(String(format: "%02d", s))s" : "\(s)s"
    }
}

// MARK: - Heartbeat sparkline

/// A real heartbeat sparkline driven by task_progress ticks. Each tick is a beat;
/// bars are placed by their recency (newest at the right) and fade older beats so
/// the cadence reads at a glance. A faint baseline shows even with zero ticks so a
/// just-born sub-agent isn't blank.
struct Sparkline: View {
    let ticks: [Date]
    let now: Date
    let color: Color

    /// Window the sparkline shows (seconds) — recent activity only.
    private static let windowSeconds: TimeInterval = 30

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            Canvas { ctx, size in
                // Baseline.
                var baseline = Path()
                baseline.move(to: CGPoint(x: 0, y: size.height - 1))
                baseline.addLine(to: CGPoint(x: size.width, y: size.height - 1))
                ctx.stroke(baseline, with: .color(color.opacity(0.18)), lineWidth: 1)

                guard !ticks.isEmpty else { return }
                let window = Self.windowSeconds
                for tick in ticks {
                    let age = now.timeIntervalSince(tick)
                    guard age >= 0, age <= window else { continue }
                    // x: newest beats to the right.
                    let frac = 1 - (age / window)
                    let x = frac * Double(size.width)
                    // Bar height pulses with recency.
                    let barH = (0.4 + 0.6 * (1 - age / window)) * Double(size.height)
                    var bar = Path()
                    bar.move(to: CGPoint(x: x, y: size.height - 1))
                    bar.addLine(to: CGPoint(x: x, y: size.height - barH))
                    ctx.stroke(bar, with: .color(color.opacity(0.85)), lineWidth: 1.5)
                }
            }
            .frame(width: w, height: h)
        }
    }
}
