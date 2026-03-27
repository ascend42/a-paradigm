// TerminalSession.swift — #terminal-session
// Model for an embedded terminal session running Claude Code.

import Foundation

/// Status of an embedded terminal session.
enum SessionStatus: Equatable {
    case starting
    case running
    case idle
    case exited(code: Int32)

    var label: String {
        switch self {
        case .starting: return "starting"
        case .running: return "running"
        case .idle: return "idle"
        case .exited(let code): return "exited (\(code))"
        }
    }

    var isAlive: Bool {
        switch self {
        case .starting, .running, .idle: return true
        case .exited: return false
        }
    }
}

/// An embedded terminal session with process lifecycle tracking.
struct TerminalSession: Identifiable, Equatable {
    let id: String
    let projectPath: String
    var label: String
    var status: SessionStatus
    var shellPID: pid_t?
    var claudePID: pid_t?
    var symphonyAgentId: String?
    let createdAt: Date
    var cellId: String?

    init(projectPath: String, label: String? = nil) {
        self.id = "session-\(UUID().uuidString.prefix(8))"
        self.projectPath = projectPath
        self.label = label ?? URL(fileURLWithPath: projectPath).lastPathComponent
        self.status = .starting
        self.createdAt = Date()
    }

    static func == (lhs: TerminalSession, rhs: TerminalSession) -> Bool {
        lhs.id == rhs.id
    }
}
