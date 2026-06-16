// BackgroundShell.swift — #atrium-shells
// Observable record of a background shell the agent spawned during the session.
// Background shells are commands the agent ran with run_in_background (or that
// the harness backgrounded). The stream surfaces them as a tool_result whose
// TEXT contains "Command running in background with ID: <id>", and/or as system
// task events. Claude Code does NOT kill these on session exit — they orphan to
// PID 1 — so the host (ClaudeStreamSession) must track and clean them up.

import Foundation

/// Lifecycle state of a tracked background shell.
///
/// Terminal-status mapping (#atrium-shells): a `task_updated`/`task_notification`
/// event carries a status string. ANY non-"running" terminal value MUST move the
/// shell out of `.running` — the panel must never keep showing "running" once a
/// terminal task event has arrived. Observed status strings and their mapping:
///   - "running"                                  → .running  (stay running)
///   - "completed" / "success" / "done" /
///     "finished" / "exited"                      → .finished
///   - "stopped"                                  → .stopped
///   - "killed"                                   → .killed
///   - "failed" / "error"                         → .failed
/// NOTE (Claude Code 2.1.x): a background task that is killed via the agent's
/// TaskStop tool reports terminal status "failed" (exit 144 / SIGURG underneath),
/// NOT "killed". `.failed` therefore covers the founder-clicked-Kill case and
/// renders as an error tone in the panel.
enum BackgroundShellStatus: String, Sendable {
    case running
    case finished
    /// The command exited on its own (task_updated/notification status "stopped").
    case stopped
    case killed
    /// The command ended in a terminal error/failure state (status "failed" or
    /// "error"). Also the observed terminal status when a background task is
    /// stopped via the agent's TaskStop tool in Claude Code 2.1.x.
    case failed
}

extension BackgroundShellStatus {
    /// True once the shell has reached a terminal lifecycle state — i.e. anything
    /// other than `.running`. Used so the panel never shows "running" after a
    /// terminal task event arrives.
    var isTerminal: Bool { self != .running }
}

/// One background shell spawned by the agent, tracked from the event stream.
struct BackgroundShell: Identifiable, Sendable {
    /// The shell id (e.g. "bu2e52p2v") extracted from the tool_result text or a
    /// system task event (task_id). This is the identity used for correlation and
    /// the suppressed-control TaskStop turn (the Claude Code 2.1.x kill tool).
    let id: String
    /// The command that was backgrounded (correlated from the matching Bash
    /// tool_use input.command when available).
    var command: String
    /// When we first observed this shell.
    let startedAt: Date
    /// Current lifecycle state.
    var status: BackgroundShellStatus
    /// Latest output snippet we've seen for this shell. With direct host-side
    /// inspection (FIX 3) this holds the full contents read from `outputFile`.
    var lastOutput: String?
    /// Absolute path to the `.output` file the harness writes the background
    /// command's stdout/stderr to. Parsed from the tool_result text
    /// "Output is being written to: <ABSOLUTE_PATH>.output". This is what host-side
    /// Inspect reads and what `lsof` targets for host-side Kill (FIX 3). There are
    /// NO pid files (verified) — only this .output file.
    var outputFile: String?

    init(
        id: String,
        command: String,
        startedAt: Date = Date(),
        status: BackgroundShellStatus = .running,
        lastOutput: String? = nil,
        outputFile: String? = nil
    ) {
        self.id = id
        self.command = command
        self.startedAt = startedAt
        self.status = status
        self.lastOutput = lastOutput
        self.outputFile = outputFile
    }
}
