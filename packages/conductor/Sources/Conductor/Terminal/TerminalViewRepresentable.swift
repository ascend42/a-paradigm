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

        // Add drag-and-drop overlay (transparent, passes all mouse events through)
        let dragOverlay = TerminalDragOverlayView(frame: .zero)
        dragOverlay.terminalView = terminalView
        dragOverlay.translatesAutoresizingMaskIntoConstraints = false
        terminalView.addSubview(dragOverlay)
        NSLayoutConstraint.activate([
            dragOverlay.leadingAnchor.constraint(equalTo: terminalView.leadingAnchor),
            dragOverlay.trailingAnchor.constraint(equalTo: terminalView.trailingAnchor),
            dragOverlay.topAnchor.constraint(equalTo: terminalView.topAnchor),
            dragOverlay.bottomAnchor.constraint(equalTo: terminalView.bottomAnchor),
        ])

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
        // Always apply font — NSFont equality is unreliable and font size changes
        // must propagate immediately when the session manager's appearance updates
        let currentSize = terminalView.font.pointSize
        if currentSize != appearance.fontSize {
            terminalView.font = appearance.font
        }
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, LocalProcessTerminalViewDelegate {
        let session: TerminalSession
        weak var terminalView: LocalProcessTerminalView?
        var onProcessTerminated: ((Int32) -> Void)?
        var onBecameFirstResponder: (() -> Void)?
        private var eventMonitor: Any?

        init(session: TerminalSession, onProcessTerminated: ((Int32) -> Void)?, onBecameFirstResponder: (() -> Void)?) {
            self.session = session
            self.onProcessTerminated = onProcessTerminated
            self.onBecameFirstResponder = onBecameFirstResponder
            super.init()

            // Monitor mouse clicks to detect focus changes
            eventMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
                guard let self, let tv = self.terminalView else { return event }
                // Check if the click is inside our terminal view
                let locationInView = tv.convert(event.locationInWindow, from: nil)
                if tv.bounds.contains(locationInView) {
                    self.onBecameFirstResponder?()
                }
                return event
            }
        }

        deinit {
            if let monitor = eventMonitor {
                NSEvent.removeMonitor(monitor)
            }
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
