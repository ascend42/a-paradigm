// FleetSpineView.swift — #fleet-spine / #session-row
// THE BRIDGE's left spine. A "bridge bar" header ("N sessions · M needs you") over
// a STATUS-GROUPED session list:
//
//   NEEDS YOU   — always first, NOT collapsible, hidden when empty (AMBER, pages)
//   WORKING     — teal, breathing rows
//   IDLE        — muted; auto-collapses past 1 row (density)
//
// Governing rule (Mika): loudness scales ONLY with how much the human is needed.
// A calm fleet shows "all calm" in muted ink; the moment a session finishes a turn
// while you looked elsewhere it warms AMBER (~600ms), floats into NEEDS YOU, and
// breathes — the center NEVER moves and focus is NEVER stolen (no auto-switch).
//
// Only WORKING + NEEDS YOU rows animate at rest (4s breathe / 3s pulse). IDLE and
// error rows are still. NEEDS YOU rows never compact.

import SwiftUI

struct FleetSpineView: View {
    @ObservedObject var store: FleetStore
    let onNewSession: () -> Void

    /// Manual collapse state for the IDLE group (auto-collapsed past 1 by default).
    @State private var idleCollapsed = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            bridgeBar
            Divider().overlay(AtriumTheme.hairline)

            // One shared clock so every row's breathe/pulse/age ticks in lockstep.
            TimelineView(.periodic(from: .now, by: 1)) { context in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        groupedList(now: context.date)
                    }
                    .padding(10)
                }
            }

            Spacer(minLength: 0)
            Divider().overlay(AtriumTheme.hairline)
            newSessionButton
        }
        .frame(maxHeight: .infinity)
        .background(AtriumTheme.surface)
        .overlay(alignment: .trailing) {
            Rectangle().fill(AtriumTheme.hairline).frame(width: 1)
        }
    }

    // MARK: - Bridge bar

    private var bridgeBar: some View {
        let count = store.sessions.count
        let needs = store.needsYouCount
        return VStack(alignment: .leading, spacing: 3) {
            Text("THE BRIDGE")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundColor(AtriumTheme.ink)
                .tracking(1.5)
            HStack(spacing: 6) {
                Text("\(count) \(count == 1 ? "session" : "sessions")")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
                if needs > 0 {
                    Text("·")
                        .font(AtriumTheme.footerFont)
                        .foregroundColor(AtriumTheme.inkMuted)
                    Text("\(needs) needs you")
                        .font(AtriumTheme.footerFont)
                        .foregroundColor(AtriumTheme.amber)
                } else if count > 0 {
                    Text("· all calm")
                        .font(AtriumTheme.footerFont)
                        .foregroundColor(AtriumTheme.inkMuted)
                }
                if store.shouldWarnCount {
                    Spacer()
                    Text(store.atSoftCap ? "at cap" : "busy")
                        .font(AtriumTheme.footerFont)
                        .foregroundColor(AtriumTheme.amber.opacity(0.8))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(AtriumTheme.sunken)
    }

    // MARK: - Grouped list

    /// Partition the fleet by derived status (computed against the live active id).
    /// Returns (needsYou, working, idle) — extracted out of the ViewBuilder so the
    /// control-flow partition is plain Swift, not a result-builder body.
    private func partition() -> (needsYou: [ClaudeStreamSession], working: [ClaudeStreamSession], idle: [ClaudeStreamSession]) {
        let active = store.activeSessionId
        var needsYou: [ClaudeStreamSession] = []
        var working: [ClaudeStreamSession] = []
        var idle: [ClaudeStreamSession] = []
        for s in store.sessions {
            switch s.derivedStatus(isActiveSession: s.id == active) {
            case .awaitingYou: needsYou.append(s)
            case .running: working.append(s)
            case .idle, .blocked, .done: idle.append(s)
            }
        }
        return (needsYou, working, idle)
    }

    @ViewBuilder
    private func groupedList(now: Date) -> some View {
        let groups = partition()
        let needsYou = groups.needsYou
        let working = groups.working
        let idle = groups.idle

        // Density tier — at 9+ sessions, WORKING rows go compact (NEEDS YOU never).
        let compactWorking = store.sessions.count >= 9

        if !needsYou.isEmpty {
            groupHeader("NEEDS YOU", count: needsYou.count, tint: AtriumTheme.amber, collapsible: false)
            ForEach(needsYou) { session in
                row(session, now: now, compact: false)
            }
        }

        if !working.isEmpty {
            groupHeader("WORKING", count: working.count, tint: AtriumTheme.running, collapsible: false)
            ForEach(working) { session in
                row(session, now: now, compact: compactWorking)
            }
        }

        if !idle.isEmpty {
            // IDLE auto-collapses past 1 row. The header toggles it; a single idle
            // session is always shown (collapsing one row buys nothing).
            let autoCollapse = idle.count > 1 && idleCollapsed
            Button(action: { idleCollapsed.toggle() }) {
                groupHeaderBody("IDLE", count: idle.count, tint: AtriumTheme.inkMuted,
                                chevron: idle.count > 1 ? (idleCollapsed ? "chevron.right" : "chevron.down") : nil)
            }
            .buttonStyle(.plain)
            if !autoCollapse {
                ForEach(idle) { session in
                    row(session, now: now, compact: store.sessions.count >= 6)
                }
            }
        }

        if store.sessions.isEmpty {
            Text("No sessions yet.\nStart one below.")
                .font(AtriumTheme.footerFont)
                .foregroundColor(AtriumTheme.hairline)
                .multilineTextAlignment(.leading)
                .padding(.top, 8)
        }
    }

    private func groupHeader(_ title: String, count: Int, tint: Color, collapsible: Bool) -> some View {
        groupHeaderBody(title, count: count, tint: tint, chevron: nil)
    }

    private func groupHeaderBody(_ title: String, count: Int, tint: Color, chevron: String?) -> some View {
        HStack(spacing: 6) {
            Text(title)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(tint)
                .tracking(1.0)
            Text("\(count)")
                .font(AtriumTheme.footerFont)
                .foregroundColor(AtriumTheme.inkMuted)
            Spacer()
            if let chevron {
                Image(systemName: chevron)
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundColor(AtriumTheme.inkMuted)
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)
        .contentShape(Rectangle())
    }

    private func row(_ session: ClaudeStreamSession, now: Date, compact: Bool) -> some View {
        SessionRow(
            session: session,
            now: now,
            isActive: session.id == store.activeSessionId,
            compact: compact,
            onSelect: { store.setActive(session.id) },
            onClose: { store.close(session.id) }
        )
    }

    // MARK: - New session

    private var newSessionButton: some View {
        Button(action: onNewSession) {
            HStack(spacing: 7) {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .semibold))
                Text("new session")
                    .font(AtriumTheme.chipFont)
                Spacer()
                Text("⌘N")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
            }
            .foregroundColor(store.atSoftCap ? AtriumTheme.inkMuted : AtriumTheme.user)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(store.atSoftCap ? "Fleet at soft cap — you can still spawn, but the bridge is busy" : "Spawn a new session")
        .background(AtriumTheme.sunken)
    }
}

// MARK: - Session row (#session-row)

/// One session in the spine. Anatomy mirrors AtriumChorusRow:
///   [status glyph] · prose `projectName` (+ optional model) · mono `model · age`
///   subtitle · one-line last-activity preview (italic, muted) · `age · ~tokens`
///   micro-signal. Active row = blue left-edge + surfaceRaised fill.
///
/// Animation law: only WORKING (4s glyph breathe) + NEEDS YOU (3s pulse + faint
/// amber wash + glow) animate at rest. IDLE / error / done are still.
struct SessionRow: View {
    @ObservedObject var session: ClaudeStreamSession
    let now: Date
    let isActive: Bool
    let compact: Bool
    let onSelect: () -> Void
    let onClose: () -> Void

    @State private var hovering = false

    private var status: SessionDerivedStatus {
        session.derivedStatus(isActiveSession: isActive)
    }

    var body: some View {
        Button(action: onSelect) {
            rowBody
        }
        .buttonStyle(.plain)
        .background(rowBackground)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(borderColor, lineWidth: isActive ? 1 : 0.5)
        )
        .overlay(alignment: .leading) {
            // Active = blue left edge; NEEDS YOU keeps an amber edge when not active.
            if isActive {
                edge(AtriumTheme.user)
            } else if status == .awaitingYou {
                edge(AtriumTheme.amber)
            }
        }
        .onHover { hovering = $0 }
    }

    private func edge(_ color: Color) -> some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(color)
            .frame(width: 3)
            .padding(.vertical, 4)
    }

    private var rowBody: some View {
        HStack(alignment: .top, spacing: 8) {
            statusGlyph
                .frame(width: 14)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: compact ? 1 : 3) {
                // Prose: projectName leads (+ branch when we have one — v2).
                HStack(spacing: 6) {
                    Text(session.projectName)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(AtriumTheme.ink)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if hovering || isActive {
                        Button(action: onClose) {
                            Image(systemName: "xmark")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundColor(AtriumTheme.inkMuted)
                        }
                        .buttonStyle(.plain)
                        .help("Close session")
                    }
                }
                // Mono subtitle: model · activity.
                Text(subtitle)
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
                    .lineLimit(1)

                if !compact, let preview = session.lastActivityPreview {
                    Text(preview)
                        .font(AtriumTheme.footerFont)
                        .foregroundColor(AtriumTheme.inkMuted.opacity(0.85))
                        .italic()
                        .lineLimit(1)
                }

                // Micro-signal: age · ~tokens.
                HStack(spacing: 5) {
                    Text(status.label)
                        .font(AtriumTheme.footerFont)
                        .foregroundColor(status.temperatureColor)
                    if let tokens = session.approxTokensLabel {
                        Text("· \(tokens)")
                            .font(AtriumTheme.footerFont)
                            .foregroundColor(AtriumTheme.inkMuted)
                    }
                }
            }
        }
        .padding(compact ? 7 : 9)
        .contentShape(Rectangle())
    }

    /// Subtitle "model · 12s" (age since last event).
    private var subtitle: String {
        let model = session.model.map { Self.shortModel($0) } ?? "starting…"
        let age = AtriumChorusRow.elapsedString(max(0, now.timeIntervalSince(session.lastEventAt)))
        return "\(model) · \(age)"
    }

    // MARK: Status glyph (the ONLY animating element)

    @ViewBuilder
    private var statusGlyph: some View {
        switch status {
        case .running:
            // teal — slow 4s breathe.
            BreathingGlyph(glyph: status.glyph, color: status.temperatureColor, period: 4, now: now)
        case .awaitingYou:
            // AMBER — slow 3s pulse + glow (SACRED; the only state that pages).
            PulsingGlyph(glyph: status.glyph, color: status.temperatureColor, period: 3, now: now)
        case .idle, .blocked, .done:
            // Still — coral/idle/done do NOT animate at rest.
            Text(status.glyph)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(status.temperatureColor)
        }
    }

    // MARK: Backgrounds / borders

    private var rowBackground: some View {
        ZStack {
            if isActive {
                AtriumTheme.surfaceRaised
            } else if status == .awaitingYou {
                // Faint amber WASH (Mika) — slow 3s pulse, very subtle.
                AtriumTheme.amber.opacity(amberWashOpacity)
            } else {
                Color.clear
            }
        }
    }

    private var borderColor: Color {
        if isActive { return AtriumTheme.user }
        switch status {
        case .awaitingYou: return AtriumTheme.amber.opacity(0.45)
        case .running: return AtriumTheme.running.opacity(0.22)
        case .blocked: return AtriumTheme.blocked.opacity(0.35)
        case .idle, .done: return AtriumTheme.hairline
        }
    }

    /// 3s-period amber wash opacity (faint), driven by the shared clock.
    private var amberWashOpacity: Double {
        let t = now.timeIntervalSinceReferenceDate
        let phase = (sin(t / 3.0 * .pi * 2) + 1) / 2 // 0…1
        return 0.05 + 0.05 * phase
    }

    /// "opus-4.8" → "opus", "claude-sonnet-4" → "sonnet", best-effort short label.
    static func shortModel(_ model: String) -> String {
        let lower = model.lowercased()
        if lower.contains("opus") { return "opus" }
        if lower.contains("sonnet") { return "sonnet" }
        if lower.contains("haiku") { return "haiku" }
        return model
    }
}

// MARK: - Animated glyphs (running breathe / awaitingYou pulse)

/// teal glyph that breathes (opacity) on a slow period — autonomous-work signal.
private struct BreathingGlyph: View {
    let glyph: String
    let color: Color
    let period: Double
    let now: Date

    var body: some View {
        let t = now.timeIntervalSinceReferenceDate
        let phase = (sin(t / period * .pi * 2) + 1) / 2
        Text(glyph)
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(color)
            .opacity(0.55 + 0.45 * phase)
    }
}

/// AMBER glyph that pulses + glows — the SACRED "needs you" page. Slow, calm.
private struct PulsingGlyph: View {
    let glyph: String
    let color: Color
    let period: Double
    let now: Date

    var body: some View {
        let t = now.timeIntervalSinceReferenceDate
        let phase = (sin(t / period * .pi * 2) + 1) / 2
        Text(glyph)
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(color)
            .opacity(0.7 + 0.3 * phase)
            .shadow(color: color.opacity(0.4 + 0.4 * phase), radius: 3 + 3 * phase)
    }
}
