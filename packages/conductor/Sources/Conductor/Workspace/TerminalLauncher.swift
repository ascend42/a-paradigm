// TerminalLauncher.swift — #terminal-launcher
// Launches Claude Code in various terminal applications.
// Uses AppleScript for Terminal.app/iTerm2, NSWorkspace for others.

import AppKit
import Foundation

/// Launches Claude Code terminal windows in the user's preferred terminal.
struct TerminalLauncher {

    /// Launch Claude Code in the specified terminal app at the given project directory.
    /// Returns the process ID of the launched terminal window.
    @MainActor
    static func launch(
        terminal: TerminalApp,
        projectDirectory: String,
        label: String? = nil
    ) async throws -> pid_t {
        let command = "cd \(shellEscape(projectDirectory)) && claude"

        switch terminal {
        case .terminal:
            return try await launchViaAppleScript(
                script: terminalAppScript(command: command),
                bundleID: terminal.bundleID
            )
        case .iterm2:
            return try await launchViaAppleScript(
                script: iterm2Script(command: command),
                bundleID: terminal.bundleID
            )
        default:
            return try launchViaProcess(terminal: terminal, command: command)
        }
    }

    /// Detect the user's default/preferred terminal.
    static func detectDefaultTerminal() -> TerminalApp {
        // Check which terminal apps are installed
        let workspace = NSWorkspace.shared
        for app in TerminalApp.allCases {
            if workspace.urlForApplication(withBundleIdentifier: app.bundleID) != nil {
                // Prefer iTerm2 > Ghostty > Terminal.app
                if app == .iterm2 || app == .ghostty {
                    return app
                }
            }
        }
        return .terminal // Always available on macOS
    }

    // MARK: - AppleScript Launching

    private static func launchViaAppleScript(script: String, bundleID: String) async throws -> pid_t {
        let appleScript = NSAppleScript(source: script)
        var error: NSDictionary?
        appleScript?.executeAndReturnError(&error)

        if let error {
            throw TerminalLauncherError.appleScriptFailed(
                String(describing: error[NSAppleScript.errorMessage] ?? "Unknown error")
            )
        }

        // Wait briefly for the terminal to launch, then find its PID
        try await Task.sleep(for: .milliseconds(500))

        let apps = NSWorkspace.shared.runningApplications
        if let app = apps.first(where: { $0.bundleIdentifier == bundleID }) {
            return app.processIdentifier
        }

        throw TerminalLauncherError.processNotFound
    }

    private static func terminalAppScript(command: String) -> String {
        """
        tell application "Terminal"
            activate
            do script "\(command)"
        end tell
        """
    }

    private static func iterm2Script(command: String) -> String {
        """
        tell application "iTerm"
            activate
            tell current window
                create tab with default profile
                tell current session
                    write text "\(command)"
                end tell
            end tell
        end tell
        """
    }

    // MARK: - Process Launching

    private static func launchViaProcess(terminal: TerminalApp, command: String) throws -> pid_t {
        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: terminal.bundleID) else {
            throw TerminalLauncherError.terminalNotInstalled(terminal.rawValue)
        }

        let config = NSWorkspace.OpenConfiguration()
        config.arguments = ["-e", command]

        // Use NSWorkspace to open the terminal app
        // The PID will be captured asynchronously
        NSWorkspace.shared.openApplication(at: appURL, configuration: config)

        // Wait and find the PID
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
