// TerminalViewRepresentable.swift — #terminal-view-representable
// NSViewRepresentable wrapping SwiftTerm's LocalProcessTerminalView.
// Handles PTY creation, process spawning, and SwiftUI integration.

import SwiftUI
import AppKit
import SwiftTerm

/// SwiftUI wrapper for SwiftTerm's LocalProcessTerminalView.
struct TerminalViewRepresentable: NSViewRepresentable {
    let session: TerminalSession
    let appearance: TerminalAppearance
    var onProcessTerminated: ((Int32) -> Void)?
    var onBecameFirstResponder: (() -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(
            session: session,
            onProcessTerminated: onProcessTerminated,
            onBecameFirstResponder: onBecameFirstResponder
        )
    }

    func makeNSView(context: Context) -> LocalProcessTerminalView {
        let terminalView = LocalProcessTerminalView(frame: .zero)

        // Configure appearance
        terminalView.font = appearance.font
        terminalView.nativeBackgroundColor = appearance.backgroundColor
        terminalView.nativeForegroundColor = appearance.foregroundColor

        // Set coordinator as delegate
        terminalView.processDelegate = context.coordinator
        context.coordinator.terminalView = terminalView

        // Build environment
        var env = ProcessInfo.processInfo.environment
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["PARADIGM_CONDUCTOR"] = "1"
        env["PARADIGM_SESSION_ID"] = session.id
        env.removeValue(forKey: "TERM_PROGRAM")

        // Spawn shell with claude
        let shell = env["SHELL"] ?? "/bin/zsh"
        terminalView.startProcess(
            executable: shell,
            args: ["-l", "-c", "claude"],
            environment: env.map { "\($0.key)=\($0.value)" },
            execName: nil,
            currentDirectory: session.projectPath
        )

        return terminalView
    }

    func updateNSView(_ terminalView: LocalProcessTerminalView, context: Context) {
        // Update appearance if changed
        if terminalView.font != appearance.font {
            terminalView.font = appearance.font
        }
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, LocalProcessTerminalViewDelegate {
        let session: TerminalSession
        weak var terminalView: LocalProcessTerminalView?
        var onProcessTerminated: ((Int32) -> Void)?
        var onBecameFirstResponder: (() -> Void)?

        init(session: TerminalSession, onProcessTerminated: ((Int32) -> Void)?, onBecameFirstResponder: (() -> Void)?) {
            self.session = session
            self.onProcessTerminated = onProcessTerminated
            self.onBecameFirstResponder = onBecameFirstResponder
        }

        // MARK: LocalProcessTerminalViewDelegate

        func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {
            // PTY resize handled internally by SwiftTerm
        }

        func setTerminalTitle(source: LocalProcessTerminalView, title: String) {
            // Could update session label
        }

        func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {
            // Could track cwd for Symphony context
        }

        func processTerminated(source: TerminalView, exitCode: Int32?) {
            let code = exitCode ?? -1
            onProcessTerminated?(code)
        }
    }
}
