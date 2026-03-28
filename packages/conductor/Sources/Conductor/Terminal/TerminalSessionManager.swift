// TerminalSessionManager.swift — #terminal-session-manager
// Owns all embedded terminal sessions. Tracks active session for sidebar filtering.
// Bridges sessions to Symphony auto-link via AgentPartManager.

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

    /// Agent part manager for Symphony registration (injected by AppDelegate).
    weak var agentPartManager: AgentPartManager?

    /// Thread watcher for rescanning after new agents register.
    weak var threadWatcher: SymphonyThreadWatcher?

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

        // Start Symphony auto-link for this session
        startSymphonyLink(sessionId: session.id, projectPath: projectPath)

        return session
    }

    /// Remove a session by ID.
    func removeSession(id: String) {
        // Unregister from Symphony if linked
        if let session = sessions.first(where: { $0.id == id }),
           let agentId = session.symphonyAgentId {
            agentPartManager?.unregisterAgent(agentId)
        }

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

    // MARK: - Symphony Auto-Link

    /// Register a session's project with Symphony and start watching for its threads.
    private func startSymphonyLink(sessionId: String, projectPath: String) {
        guard let partManager = agentPartManager else { return }

        // Register with Symphony immediately using the project directory
        let identity = partManager.registerAgent(projectDir: projectPath, role: "core")
        linkToSymphony(sessionId: sessionId, agentId: identity.id)

        // Rescan thread watcher so the new agent's mailbox is visible
        threadWatcher?.rescanAgents()

        ConductorLog.component("terminal-session-manager")
            .info("Symphony auto-link: \(identity.id)")
    }

    // MARK: - Active Session Filtering

    /// The Symphony agent ID for the currently focused session (for sidebar filtering).
    var activeSessionAgentId: String? {
        guard let id = activeSessionId else { return nil }
        return sessions.first { $0.id == id }?.symphonyAgentId
    }

    /// The project name for the currently focused session.
    var activeSessionProject: String? {
        guard let id = activeSessionId else { return nil }
        guard let session = sessions.first(where: { $0.id == id }) else { return nil }
        return URL(fileURLWithPath: session.projectPath).lastPathComponent
    }

    /// Count of Symphony threads involving a specific session.
    func threadCount(for sessionId: String, in threadWatcher: SymphonyThreadWatcher) -> Int {
        guard let session = sessions.first(where: { $0.id == sessionId }),
              let agentId = session.symphonyAgentId else { return 0 }

        return threadWatcher.teamThreads.values.filter { messages in
            messages.contains { $0.sender.id == agentId }
        }.count
    }
}
