// TerminalSessionState.swift — #terminal-session-state
// Terminal appearance configuration for embedded sessions.

import AppKit

/// Appearance configuration for embedded terminal views.
struct TerminalAppearance {
    var font: NSFont
    var fontSize: CGFloat
    var backgroundColor: NSColor
    var foregroundColor: NSColor
    var cursorColor: NSColor
    var selectionColor: NSColor

    /// Default appearance matching Conductor's dark theme.
    static let `default` = TerminalAppearance(
        font: NSFont.monospacedSystemFont(ofSize: 13, weight: .regular),
        fontSize: 13,
        backgroundColor: NSColor(red: 0.1, green: 0.1, blue: 0.12, alpha: 1.0),
        foregroundColor: NSColor(red: 0.85, green: 0.85, blue: 0.88, alpha: 1.0),
        cursorColor: NSColor(red: 0.4, green: 0.6, blue: 1.0, alpha: 1.0),
        selectionColor: NSColor(red: 0.3, green: 0.4, blue: 0.6, alpha: 0.5)
    )
}
