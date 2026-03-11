// TerminalLauncher.swift — #terminal-launcher
// Launches Claude Code in various terminal applications.
// Uses AppleScript for Terminal.app/iTerm2, NSWorkspace for others.
// Tracks window/session identifiers for targeted close (not kill).

import AppKit
import Foundation

/// Result of launching a terminal — includes identifiers for targeted close.
struct LaunchedTerminal {
    let processID: pid_t
    /// AppleScript window/session identifier for targeted close.
    /// Terminal.app: window ID string. iTerm2: session ID string.
    let windowIdentifier: String?
    let terminalApp: TerminalApp
}

/// Launches Claude Code terminal windows in the user's preferred terminal.
struct TerminalLauncher {

    /// Launch Claude Code in the specified terminal app at the given project directory.
    /// Returns launch result with PID and window identifier for targeted close.
    @MainActor
    static func launch(
        terminal: TerminalApp,
        projectDirectory: String,
        label: String? = nil
    ) async throws -> LaunchedTerminal {
        let command = "cd \(shellEscape(projectDirectory)) && claude"

        switch terminal {
        case .terminal:
            return try await launchTerminalApp(command: command)
        case .iterm2:
            return try await launchITerm2(command: command)
        default:
            let pid = try launchViaProcess(terminal: terminal, command: command)
            return LaunchedTerminal(processID: pid, windowIdentifier: nil, terminalApp: terminal)
        }
    }

    /// Close a specific terminal window without killing the entire application.
    @MainActor
    static func closeWindow(terminal: TerminalApp, windowIdentifier: String?, processID: pid_t?) {
        // Try AppleScript targeted close first
        if let windowID = windowIdentifier {
            switch terminal {
            case .terminal:
                closeTerminalAppWindow(windowID: windowID)
                return
            case .iterm2:
                closeITerm2Session(sessionID: windowID)
                return
            default:
                break
            }
        }

        // Fallback for non-scriptable terminals: terminate the specific process
        // For apps like Ghostty/Kitty/Alacritty that run separate processes per window,
        // killing the PID is safe and only affects that window.
        if let pid = processID {
            kill(pid, SIGTERM)
        }
    }

    /// Detect the user's default/preferred terminal.
    static func detectDefaultTerminal() -> TerminalApp {
        let workspace = NSWorkspace.shared
        for app in TerminalApp.allCases {
            if workspace.urlForApplication(withBundleIdentifier: app.bundleID) != nil {
                if app == .iterm2 || app == .ghostty {
                    return app
                }
            }
        }
        return .terminal
    }

    // MARK: - Terminal.app

    private static func launchTerminalApp(command: String) async throws -> LaunchedTerminal {
        // AppleScript that opens a new window and returns the front window's ID.
        // `do script` without `in` creates a new window; we grab its ID after creation.
        let script = """
        tell application "Terminal"
            activate
            do script "\(command)"
            set windowID to id of front window
            return windowID as text
        end tell
        """

        let appleScript = NSAppleScript(source: script)
        var error: NSDictionary?
        let result = appleScript?.executeAndReturnError(&error)

        if let error {
            throw TerminalLauncherError.appleScriptFailed(
                String(describing: error[NSAppleScript.errorMessage] ?? "Unknown error")
            )
        }

        let windowID = result?.stringValue

        try await Task.sleep(for: .milliseconds(500))

        let apps = NSWorkspace.shared.runningApplications
        if let app = apps.first(where: { $0.bundleIdentifier == TerminalApp.terminal.bundleID }) {
            return LaunchedTerminal(
                processID: app.processIdentifier,
                windowIdentifier: windowID,
                terminalApp: .terminal
            )
        }

        throw TerminalLauncherError.processNotFound
    }

    private static func closeTerminalAppWindow(windowID: String) {
        let script = """
        tell application "Terminal"
            repeat with w in windows
                if (id of w as text) is "\(windowID)" then
                    close w
                    return
                end if
            end repeat
        end tell
        """
        let appleScript = NSAppleScript(source: script)
        var error: NSDictionary?
        appleScript?.executeAndReturnError(&error)

        if let error {
            ConductorLog.component("terminal-launcher")
                .error("Failed to close Terminal window \(windowID): \(error)")
        }
    }

    // MARK: - iTerm2

    private static func launchITerm2(command: String) async throws -> LaunchedTerminal {
        // AppleScript that creates a new tab and returns the session ID
        let script = """
        tell application "iTerm"
            activate
            tell current window
                set newTab to (create tab with default profile)
                tell current session of newTab
                    write text "\(command)"
                    set sessionID to id
                end tell
            end tell
            return sessionID
        end tell
        """

        let appleScript = NSAppleScript(source: script)
        var error: NSDictionary?
        let result = appleScript?.executeAndReturnError(&error)

        if let error {
            throw TerminalLauncherError.appleScriptFailed(
                String(describing: error[NSAppleScript.errorMessage] ?? "Unknown error")
            )
        }

        let sessionID = result?.stringValue

        try await Task.sleep(for: .milliseconds(500))

        let apps = NSWorkspace.shared.runningApplications
        if let app = apps.first(where: { $0.bundleIdentifier == TerminalApp.iterm2.bundleID }) {
            return LaunchedTerminal(
                processID: app.processIdentifier,
                windowIdentifier: sessionID,
                terminalApp: .iterm2
            )
        }

        throw TerminalLauncherError.processNotFound
    }

    private static func closeITerm2Session(sessionID: String) {
        let script = """
        tell application "iTerm"
            repeat with w in windows
                repeat with t in tabs of w
                    repeat with s in sessions of t
                        if id of s is "\(sessionID)" then
                            close t
                            return
                        end if
                    end repeat
                end repeat
            end repeat
        end tell
        """
        let appleScript = NSAppleScript(source: script)
        var error: NSDictionary?
        appleScript?.executeAndReturnError(&error)

        if let error {
            ConductorLog.component("terminal-launcher")
                .error("Failed to close iTerm2 session \(sessionID): \(error)")
        }
    }

    // MARK: - Process Launching (Ghostty, Kitty, Alacritty, Warp)

    private static func launchViaProcess(terminal: TerminalApp, command: String) throws -> pid_t {
        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: terminal.bundleID) else {
            throw TerminalLauncherError.terminalNotInstalled(terminal.rawValue)
        }

        let config = NSWorkspace.OpenConfiguration()
        config.arguments = ["-e", command]

        NSWorkspace.shared.openApplication(at: appURL, configuration: config)

        let apps = NSWorkspace.shared.runningApplications
        if let app = apps.first(where: { $0.bundleIdentifier == terminal.bundleID }) {
            return app.processIdentifier
        }

        throw TerminalLauncherError.processNotFound
    }

    // MARK: - Helpers

    private static func shellEscape(_ path: String) -> String {
        "'" + path.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

// MARK: - Errors

enum TerminalLauncherError: Error, LocalizedError {
    case appleScriptFailed(String)
    case terminalNotInstalled(String)
    case processNotFound

    var errorDescription: String? {
        switch self {
        case .appleScriptFailed(let msg):
            return "AppleScript launch failed: \(msg)"
        case .terminalNotInstalled(let name):
            return "\(name) is not installed"
        case .processNotFound:
            return "Could not find launched terminal process"
        }
    }
}
