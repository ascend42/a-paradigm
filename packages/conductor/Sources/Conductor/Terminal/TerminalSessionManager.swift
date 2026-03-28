// TerminalSessionManager.swift — #terminal-session-manager
// Owns all embedded terminal sessions. Tracks active session for sidebar filtering.
// Bridges sessions to Symphony auto-link.

import Foundation
import SwiftUI

/// Manages embedded terminal sessions in the Conductor workspace.
@MainActor
final class TerminalSessionManager: ObservableObject {

    /// All active sessions.
    @Published private(set) var sessions: [TerminalSession] = []

    /// Currently focused session ID (drives sidebar context).
    @Published var activeSessionId: String?

    /// Maximum concurrent sessions.
    let maxSessions = 8

    // MARK: - Session CRUD

    /// Create a new session for the given project directory.
    @discardableResult
    func createSession(projectPath: String, label: String? = nil) -> TerminalSession? {
        guard sessions.count < maxSessions else {
            ConductorLog.component("terminal-session-manager")
                .warning("Max sessions reached (\(self.maxSessions))")
            return nil
        }

        var session = TerminalSession(projectPath: projectPath, label: label)
        session.status = .running
        sessions.append(session)

        // Auto-focus the new session
        activeSessionId = session.id

        ConductorLog.component("terminal-session-manager")
            .info("Session created: \(session.label) (\(session.id))")

        return session
    }

    /// Remove a session by ID.
    func removeSession(id: String) {
        sessions.removeAll { $0.id == id }

        // If we removed the active session, focus the most recent
        if activeSessionId == id {
            activeSessionId = sessions.last?.id
        }

        ConductorLog.component("terminal-session-manager")
            .info("Session removed: \(id)")
    }

    /// Focus a session (updates sidebar context).
    func focusSession(id: String) {
        guard sessions.contains(where: { $0.id == id }) else { return }
        activeSessionId = id
    }

    /// Get the active session.
    var activeSession: TerminalSession? {
        guard let id = activeSessionId else { return nil }
        return sessions.first { $0.id == id }
    }

    /// Get session for a given cell ID.
    func sessionForCell(cellId: String) -> TerminalSession? {
        sessions.first { $0.cellId == cellId }
    }

    // MARK: - Lifecycle Callbacks

    /// Called when a session's process terminates.
    func reportProcessTerminated(sessionId: String, exitCode: Int32) {
        guard let index = sessions.firstIndex(where: { $0.id == sessionId }) else { return }
        sessions[index].status = .exited(code: exitCode)

        ConductorLog.component("terminal-session-manager")
            .info("Session exited: \(self.sessions[index].label) (code \(exitCode))")
    }

    /// Called when the shell PID is known.
    func reportShellPID(sessionId: String, pid: pid_t) {
        guard let index = sessions.firstIndex(where: { $0.id == sessionId }) else { return }
        sessions[index].shellPID = pid
    }

    /// Link a session to its Symphony agent ID.
    func linkToSymphony(sessionId: String, agentId: String) {
        guard let index = sessions.firstIndex(where: { $0.id == sessionId }) else { return }
        sessions[index].symphonyAgentId = agentId

        ConductorLog.component("terminal-session-manager")
            .info("Session linked to Symphony: \(self.sessions[index].label) → \(agentId)")
    }

    // MARK: - Cell Assignment

    /// Assign a session to a grid cell.
    func assignToCell(sessionId: String, cellId: String) {
        guard let index = sessions.firstIndex(where: { $0.id == sessionId }) else { return }
        sessions[index].cellId = cellId
    }

    /// Get the session assigned to a cell index (by string ID).
    func sessionForCellIndex(_ index: Int) -> TerminalSession? {
        let cellId = "cell-\(index)"
        return sessions.first { $0.cellId == cellId }
    }
}
