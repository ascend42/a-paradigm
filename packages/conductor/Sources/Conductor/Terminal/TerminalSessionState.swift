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

    /// Minimum and maximum font sizes.
    static let minFontSize: CGFloat = 9
    static let maxFontSize: CGFloat = 28
    static let fontSizeStep: CGFloat = 1

    /// Default appearance matching Conductor's dark theme.
    static let `default` = TerminalAppearance(
        font: NSFont.monospacedSystemFont(ofSize: 13, weight: .regular),
        fontSize: 13,
        backgroundColor: NSColor(red: 0.1, green: 0.1, blue: 0.12, alpha: 1.0),
        foregroundColor: NSColor(red: 0.85, green: 0.85, blue: 0.88, alpha: 1.0),
        cursorColor: NSColor(red: 0.4, green: 0.6, blue: 1.0, alpha: 1.0),
        selectionColor: NSColor(red: 0.3, green: 0.4, blue: 0.6, alpha: 0.5)
    )

    /// Return a copy with the font size adjusted.
    func withFontSize(_ size: CGFloat) -> TerminalAppearance {
        let clamped = min(max(size, Self.minFontSize), Self.maxFontSize)
        var copy = self
        copy.fontSize = clamped
        copy.font = NSFont.monospacedSystemFont(ofSize: clamped, weight: .regular)
        return copy
    }
}
