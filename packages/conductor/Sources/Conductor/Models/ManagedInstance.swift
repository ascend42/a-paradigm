// ManagedInstance.swift — #conductor-models
// Wraps a ClaudeCodeInstance with workspace management metadata.

import Foundation

/// A Claude Code instance launched and managed by Conductor's workspace manager.
struct ManagedInstance: Identifiable, Equatable {
    /// Unique identifier.
    let id: String

    /// The underlying Claude Code instance (once detected).
    var instance: ClaudeCodeInstance?

    /// Grid cell index in the workspace layout.
    var gridIndex: Int

    /// User-assigned label for this instance.
    var label: String

    /// Which terminal app was used to launch.
    let terminalApp: TerminalApp

    /// When the instance was launched.
    let launchedAt: Date

    /// The project directory this instance operates in.
    let projectDirectory: String

    /// Process ID of the launched terminal.
    var processID: pid_t?

    /// AppleScript window/session identifier for targeted close.
    /// For Terminal.app: window ID. For iTerm2: session ID.
    var windowIdentifier: String?

    /// Whether the process is still running.
    var isAlive: Bool {
        guard let pid = processID else { return false }
        return kill(pid, 0) == 0
    }

    static func == (lhs: ManagedInstance, rhs: ManagedInstance) -> Bool {
        lhs.id == rhs.id
    }
}

/// Supported terminal applications for launching Claude Code.
enum TerminalApp: String, CaseIterable, Identifiable, Codable {
    case terminal = "Terminal"
    case iterm2 = "iTerm2"
    case ghostty = "Ghostty"
    case warp = "Warp"
    case kitty = "Kitty"
    case alacritty = "Alacritty"

    var id: String { rawValue }

    /// Bundle identifier for this terminal app.
    var bundleID: String {
        switch self {
        case .terminal: return "com.apple.Terminal"
        case .iterm2: return "com.googlecode.iterm2"
        case .ghostty: return "com.mitchellh.ghostty"
        case .warp: return "dev.warp.Warp-Stable"
        case .kitty: return "net.kovidgoyal.kitty"
        case .alacritty: return "io.alacritty"
        }
    }

    /// Whether this terminal supports AppleScript for launching.
    var supportsAppleScript: Bool {
        switch self {
        case .terminal, .iterm2: return true
        default: return false
        }
    }
}
