// SessionDerivedStatus.swift — #fleet-store / #session-row
// THE BRIDGE temperature law for a WHOLE session (not just a sub-agent voice).
//
// Governing rule (Mika — "THE BRIDGE"): window/spine loudness scales ONLY with how
// much the human is needed. A fleet of N happily-working sessions stays calm.
//
//   running     → teal   (#4ED7A0) — autonomous work, NO attention; breathes slowly
//   idle        → muted  (settled, still — no animation)
//   blocked     → coral  (#FF6B6B) — error; "watch" (still, not breathing)
//   awaitingYou → AMBER  (#F2B765) — SACRED. The ONLY session-level amber. Only the
//                 spine pages; a slow pulse + faint wash + glow. amber == awaitingYou.
//   done        → muted  (settled — process stopped cleanly)
//
// The color/glyph helpers here are SHARED with AtriumChorusRail's SubAgentStatus
// temperature law (see TemperatureLaw below) so the spine and the chorus always
// agree on what teal/amber/coral mean. amber is reserved EXCLUSIVELY for "the human
// is needed" — never for autonomous work.

import SwiftUI

/// Derived, glanceable status of a whole session for THE BRIDGE spine. Computed
/// from a session's existing @Published state — no new mutable session state
/// (~session-isolation).
enum SessionDerivedStatus: String, Sendable {
    /// A turn is in flight — teal, breathes (4s glyph breathe).
    case running
    /// Settled, waiting for the next turn — muted, still.
    case idle
    /// The session errored (status .error) — coral, "watch" (still).
    case blocked
    /// Finished a turn while the founder looked elsewhere, OR a sub-agent needs the
    /// human — AMBER, the ONLY session-level amber. Pages the founder via NEEDS YOU.
    case awaitingYou
    /// The process stopped cleanly (shutdown / clean exit) — muted, settled.
    case done
}

extension SessionDerivedStatus {
    /// Live = the founder might still need to act on this, or it's still working.
    /// Drives spine grouping: awaitingYou + running are "active".
    var isLive: Bool { self == .running || self == .awaitingYou }

    /// True for the SACRED amber state — the one state that may page the founder.
    var isAttention: Bool { self == .awaitingYou }

    /// Only `running` and `awaitingYou` animate at rest (4s breathe / 3s pulse).
    /// coral (blocked) / idle / done are static "watch"/"settled" states.
    var animatesAtRest: Bool { self == .running || self == .awaitingYou }
}

// MARK: - Shared temperature-law colors/glyphs (spine + chorus agree)

/// The single source of truth for THE BRIDGE temperature colors + glyphs. Both the
/// session spine (SessionDerivedStatus) and the chorus rail (SubAgentStatus) read
/// from here so teal/amber/coral/muted mean the same thing everywhere.
enum TemperatureLaw {
    /// teal — autonomous work, NO attention needed.
    static let working = AtriumTheme.running
    /// AMBER — the human is needed. SACRED; the only state that pages.
    static let attention = AtriumTheme.amber
    /// coral — error / failure. "watch".
    static let error = AtriumTheme.blocked
    /// muted — settled / idle / done. Quiet.
    static let settled = AtriumTheme.inkMuted
}

extension SessionDerivedStatus {
    /// Temperature color for this session state (shared law).
    var temperatureColor: Color {
        switch self {
        case .running: return TemperatureLaw.working
        case .awaitingYou: return TemperatureLaw.attention
        case .blocked: return TemperatureLaw.error
        case .idle, .done: return TemperatureLaw.settled
        }
    }

    /// Leading status glyph for the spine row.
    var glyph: String {
        switch self {
        case .running: return "●"
        case .awaitingYou: return "！"
        case .blocked: return "✕"
        case .idle: return "○"
        case .done: return "◼"
        }
    }

    /// Short prose label for headers / micro-signals.
    var label: String {
        switch self {
        case .running: return "working"
        case .awaitingYou: return "needs you"
        case .blocked: return "error"
        case .idle: return "idle"
        case .done: return "done"
        }
    }
}

// MARK: - Derivation from existing @Published session state

extension ClaudeStreamSession {

    /// Derive THE BRIDGE status from existing @Published state ONLY — no new mutable
    /// session state (~session-isolation). `isActiveSession` lets the awaitingYou
    /// heuristic fire only for a NON-active session that finished a turn while the
    /// founder looked elsewhere (the page-back case). The active session you are
    /// looking at never pages itself.
    func derivedStatus(isActiveSession: Bool) -> SessionDerivedStatus {
        // blocked = the session errored. coral "watch".
        if status == .error { return .blocked }

        // PENDING DECISION ($decision-exchange) — checked FIRST and applies EVEN to
        // the active session you are looking at: a host-rendered conductor-decision
        // awaiting your pick is the truest "the human is needed" signal. SACRED amber.
        if hasPendingDecision { return .awaitingYou }

        // awaitingYou (AMBER) — v1 heuristic. SACRED amber, only when the human is
        // genuinely needed:
        //   (a) any tracked sub-agent is in .needsHuman, OR
        //   (b) the session is idle AND its last (rendered) message is the agent's
        //       AND it is NOT the active session — i.e. it finished a turn while you
        //       were looking elsewhere. Page it back.
        let subAgentNeedsHuman = subAgents.contains { $0.status == .needsHuman }
        if subAgentNeedsHuman { return .awaitingYou }
        if !isActiveSession, status == .idle, lastRenderedAuthorIsAgent {
            return .awaitingYou
        }

        switch status {
        case .running, .starting: return .running
        case .idle: return .idle
        case .stopped: return .done
        case .error: return .blocked
        }
    }

    /// The author of the last RENDERED (non-control) message is the agent. Used by
    /// the awaitingYou heuristic — a turn that just finished leaves an agent message
    /// as the tail. Control turns (suppressed TaskStop) are excluded so they never
    /// spuriously flip a session amber (#atrium-shells).
    private var lastRenderedAuthorIsAgent: Bool {
        guard let last = messages.last(where: { !$0.isControl }) else { return false }
        return last.author == .agent
    }

    /// A one-line preview of the most recent rendered activity for the spine row
    /// (italic, muted). Last rendered message's text, trimmed to a single line.
    var lastActivityPreview: String? {
        guard let last = messages.last(where: { !$0.isControl && !$0.text.isEmpty }) else { return nil }
        let oneLine = last.text
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return oneLine.isEmpty ? nil : oneLine
    }

    /// Compact "~tokens" micro-signal for the spine row, from the last usage block.
    var approxTokensLabel: String? {
        guard let usage = lastUsage else { return nil }
        let total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
        guard total > 0 else { return nil }
        return "~\(SubAgent.compactTokens(total))"
    }
}
