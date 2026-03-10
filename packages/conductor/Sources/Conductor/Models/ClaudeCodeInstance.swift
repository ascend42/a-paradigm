// ClaudeCodeInstance.swift — #conductor-models
// Data model representing a detected Claude Code terminal session.

import AppKit

/// Represents a single Claude Code terminal instance detected on screen.
struct ClaudeCodeInstance: Identifiable, Equatable {
    /// Unique identifier for this instance (derived from window ID).
    let id: String

    /// The macOS window ID (CGWindowID).
    let windowID: CGWindowID

    /// Process ID of the terminal hosting Claude Code.
    let processID: pid_t

    /// Window title (typically includes the project directory).
    let title: String

    /// The project directory Claude Code is operating in, if detectable.
    var projectDirectory: String?

    /// Current window frame on screen.
    var frame: CGRect

    /// Whether this instance is currently the gaze/manual target.
    var isTargeted: Bool = false

    /// Current operational status.
    var status: InstanceStatus = .idle

    /// Number of active sub-agents (if detectable).
    var agentCount: Int = 0

    static func == (lhs: ClaudeCodeInstance, rhs: ClaudeCodeInstance) -> Bool {
        lhs.id == rhs.id
    }
}

/// Operational status of a Claude Code instance.
enum InstanceStatus: String, Equatable {
    case idle
    case processing
    case finished
    case unknown
}
