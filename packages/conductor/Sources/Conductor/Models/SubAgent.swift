// SubAgent.swift — #sub-agent
// Observable record of a sub-agent the model spawned via the Agent/Task tool for
// parallel work — THE CHORUS. When the model parallelizes it emits an `Agent`
// tool_use (input carries the sub-agent `description` + `subagent_type`) followed
// by a `task_started` (task_id) → many `task_progress` heartbeats → a terminal
// `task_updated`/`task_notification` (status killed/stopped/completed/failed).
//
// These task_* events share the SAME wire shape as background bash shells
// (#atrium-shells), so the sub-agent filter there EXCLUDES them; this model is
// where they are routed instead (the chorus, not the shells panel).
//
// parent_tool_use_id ATTRIBUTION (verified against captured stream transcripts,
// Claude Code CLI stream-json): sub-agent task_* events carry an opaque `taskId`
// ONLY — no tool_use_id linking back to the spawning Agent tool_use, and the
// interleaved sub-agent tool_use/tool_result blocks carry NO parent_tool_use_id.
// The Agent tool_use and its first subsequent task_started are correlated only by
// TEMPORAL ADJACENCY (the task_started fires within ~30ms, before any other Agent
// tool_use). We therefore correlate by a FIFO pending-queue of Agent tool_uses.
// If a future CLI version stamps parent_tool_use_id, the decoder probe lights it
// up automatically and full nested drill-in becomes possible (flagged v2).

import Foundation

/// Lifecycle state of a tracked sub-agent (#sub-agent). Temperature law (THE
/// CHORUS): running = teal (autonomous work, no attention needed — NO amber),
/// completed/killed/stopped = inkMuted (settled, quiet), failed = coral, and amber
/// is reserved EXCLUSIVELY for `needsHuman` (a sub-agent blocked awaiting the
/// founder). `needsHuman` detection is NOT wired in v1 (flagged v2) — the case
/// exists so the UI law is complete and the state can light up when a detectable
/// signal arrives.
enum SubAgentStatus: String, Sendable {
    /// Actively working — teal heartbeat. The default while task_progress flows.
    case running
    /// Finished on its own (terminal status completed/success/finished/done/exited).
    case completed
    /// The founder clicked Stop → TaskStop → terminal (Claude Code 2.1.x reports
    /// "stopped" or "failed" for a TaskStop'd task; both land terminal/quiet).
    case stopped
    /// Killed (terminal status "killed").
    case killed
    /// Ended in error/failure (terminal status "failed"/"error").
    case failed
    /// Blocked awaiting the human — the ONLY amber state. v2: detection TBD.
    case needsHuman
}

extension SubAgentStatus {
    /// True once the sub-agent reached a terminal state — anything other than
    /// `.running` and `.needsHuman` (both of which are "live"). Used so the rail
    /// auto-hides only when NO sub-agent is live.
    var isTerminal: Bool { self != .running && self != .needsHuman }

    /// True while the sub-agent is still live (running or blocked-on-human). The
    /// CHORUS rail auto-appears while ≥1 sub-agent is live and slides away when none.
    var isLive: Bool { self == .running || self == .needsHuman }
}

/// One sub-agent voice in THE CHORUS — born at the Agent tool_use turn, driven by
/// task_started/progress/updated/notification.
struct SubAgent: Identifiable, Sendable {
    /// The task id (e.g. "a2a135f3dca8cc084") from task_started/progress/updated.
    /// This is the identity used for correlation and the suppressed TaskStop turn.
    let id: String
    /// Human description of the sub-agent's job (from the Agent tool_use input
    /// `description`). The row LEADS with this — prose over mechanics.
    var description: String
    /// The sub-agent archetype/type (from the Agent tool_use input `subagent_type`,
    /// e.g. "general-purpose", "Explore"). Rendered mono/muted as a subtitle.
    var subagentType: String?
    /// Current lifecycle state (drives the temperature law).
    var status: SubAgentStatus
    /// When we first observed this sub-agent (task_started).
    let startedAt: Date
    /// When it reached a terminal state, if it has — freezes the elapsed clock.
    var endedAt: Date?
    /// Last activity line — the most recent task_progress / tool summary we saw, so
    /// the limited v1 drill-in can show "live last-activity" without a full nested
    /// transcript (flagged v2).
    var lastActivity: String?
    /// Heartbeat ticks for the sparkline — one entry per task_progress event,
    /// capped so a long run can't grow it unbounded. Each tick records the moment a
    /// progress beat arrived; the sparkline renders the cadence (bursty vs steady).
    var progressTicks: [Date]
    /// The originating `Agent` tool_use id we correlated this sub-agent to (by
    /// temporal adjacency, since the stream carries no explicit parent link). Drives
    /// the inline fan-out block grouping. nil if correlation failed.
    var originatingToolUseId: String?

    init(
        id: String,
        description: String,
        subagentType: String? = nil,
        status: SubAgentStatus = .running,
        startedAt: Date = Date(),
        endedAt: Date? = nil,
        lastActivity: String? = nil,
        progressTicks: [Date] = [],
        originatingToolUseId: String? = nil
    ) {
        self.id = id
        self.description = description
        self.subagentType = subagentType
        self.status = status
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.lastActivity = lastActivity
        self.progressTicks = progressTicks
        self.originatingToolUseId = originatingToolUseId
    }

    /// Elapsed wall-clock for the row's right-aligned mono timer. Live sub-agents
    /// tick against `now` (passed in by a TimelineView so the whole rail shares one
    /// clock); terminal sub-agents freeze at `endedAt`.
    func elapsed(now: Date) -> TimeInterval {
        let end = endedAt ?? now
        return max(0, end.timeIntervalSince(startedAt))
    }

    /// Cap on retained progress ticks — enough to draw a meaningful sparkline
    /// without unbounded growth on a long-lived sub-agent.
    static let maxProgressTicks = 60
}
