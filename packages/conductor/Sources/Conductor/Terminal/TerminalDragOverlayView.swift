// TerminalDragOverlayView.swift — #terminal-drag-overlay
// Transparent overlay that adds drag-and-drop file support to SwiftTerm terminals.
// hitTest returns nil so all mouse events pass through to the terminal.
// Drag-and-drop works because AppKit dispatches drags based on registered types.

import AppKit
import SwiftTerm

/// Transparent overlay that handles file drag-and-drop for a terminal view.
/// Dropped file paths are shell-escaped and written to the PTY as typed text.
class TerminalDragOverlayView: NSView {

    weak var terminalView: LocalProcessTerminalView?

    /// Maximum number of files accepted in a single drop.
    private let maxFiles = 100

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        registerForDraggedTypes([.fileURL])
    }

    // MARK: - Pass-Through

    /// Return nil so all mouse events (click, scroll, selection) fall through
    /// to the terminal view underneath. Drag-and-drop bypasses hitTest.
    override func hitTest(_ point: NSPoint) -> NSView? {
        return nil
    }

    // MARK: - NSDraggingDestination

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard hasFileURLs(sender) else { return [] }
        return .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard hasFileURLs(sender) else { return [] }
        return .copy
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let urls = extractFileURLs(sender), !urls.isEmpty else { return false }

        let escapedPaths = urls.prefix(maxFiles).map { shellEscape($0.path) }
        let text = escapedPaths.joined(separator: " ") + " "

        // Write to PTY as if typed — no newline, user confirms
        terminalView?.send(txt: text)

        ConductorLog.component("terminal-drag-overlay")
            .info("Dropped \(urls.count) file(s) into terminal")

        return true
    }

    // MARK: - Helpers

    private func hasFileURLs(_ sender: NSDraggingInfo) -> Bool {
        return sender.draggingPasteboard.canReadObject(forClasses: [NSURL.self], options: [
            .urlReadingFileURLsOnly: true
        ])
    }

    private func extractFileURLs(_ sender: NSDraggingInfo) -> [URL]? {
        guard let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [
            .urlReadingFileURLsOnly: true
        ]) as? [URL] else { return nil }

        // Only accept file:// URLs
        return urls.filter { $0.isFileURL }
    }

    /// POSIX single-quote escaping — matches Terminal.app behavior.
    /// Immune to shell injection: inside single quotes, nothing is interpreted.
    /// Embedded single quotes are handled with: end quote, escaped quote, reopen quote.
    private func shellEscape(_ path: String) -> String {
        let escaped = path.replacingOccurrences(of: "'", with: "'\\''")
        return "'\(escaped)'"
    }
}
