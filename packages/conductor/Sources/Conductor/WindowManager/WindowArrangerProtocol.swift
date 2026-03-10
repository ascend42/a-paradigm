// WindowArrangerProtocol.swift — ~platform-abstracted
// Protocol for arranging Claude Code windows on screen.
// macOS: AXUIElement.setFrame() — Sprint 6
// Windows: SetWindowPos / MoveWindow (future)

import Foundation

/// Platform-abstracted window arrangement.
/// Implementations move and resize Claude Code windows into tiled layouts.
protocol WindowArrangerProtocol {
    /// Apply a layout to a set of instances.
    func applyLayout(_ layout: WindowLayout, to instances: [ClaudeCodeInstance]) throws

    /// Move a single instance to a specific frame.
    func setFrame(_ frame: CGRect, for instance: ClaudeCodeInstance) throws

    /// Get the usable screen area (excluding menu bar, dock).
    func usableScreenFrame() -> CGRect
}
