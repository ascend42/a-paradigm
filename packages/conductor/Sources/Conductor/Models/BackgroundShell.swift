// BackgroundShell.swift — #atrium-shells
// Observable record of a background shell the agent spawned during the session.
// Background shells are commands the agent ran with run_in_background (or that
// the harness backgrounded). The stream surfaces them as a tool_result whose
// TEXT contains "Command running in background with ID: <id>", and/or as system
// task events. Claude Code does NOT kill these on session exit — they orphan to
// PID 1 — so the host (ClaudeStreamSession) must track and clean them up.

import Foundation

/// Lifecycle state of a tracked background shell.
enum BackgroundShellStatus: String, Sendable {
    case running
    case finished
    case killed
}

/// One background shell spawned by the agent, tracked from the event stream.
struct BackgroundShell: Identifiable, Sendable {
    /// The shell id (e.g. "bu2e52p2v") extracted from the tool_result text or a
    /// system task event. This is the identity used for BashOutput/KillShell.
    let id: String
    /// The command that was backgrounded (correlated from the matching Bash
    /// tool_use input.command when available).
    var command: String
    /// When we first observed this shell.
    let startedAt: Date
    /// Current lifecycle state.
    var status: BackgroundShellStatus
    /// Latest output snippet we've seen for this shell (from task events or an
    /// agent-mediated BashOutput inspection).
    var lastOutput: String?

    init(
        id: String,
        command: String,
        startedAt: Date = Date(),
        status: BackgroundShellStatus = .running,
        lastOutput: String? = nil
    ) {
        self.id = id
        self.command = command
        self.startedAt = startedAt
        self.status = status
        self.lastOutput = lastOutput
    }
}
