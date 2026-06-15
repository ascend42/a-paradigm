// AtriumTheme.swift — #atrium-theme
// Visual tokens for the ATRIUM custom thread. A deep, calm, mono palette distinct
// from the rest of Conductor's system-colored UI — this is the keystone surface.

import SwiftUI

/// Color + typography tokens for the ATRIUM thread.
enum AtriumTheme {
    // MARK: - Surfaces
    static let void = Color(hex: 0x0B0E14)
    static let surface = Color(hex: 0x11151F)
    static let surfaceRaised = Color(hex: 0x171C28)
    static let sunken = Color(hex: 0x0C0F17)
    static let hairline = Color(hex: 0x222A39)

    // MARK: - Ink
    static let ink = Color(hex: 0xE6EAF2)
    static let inkMuted = Color(hex: 0x8A93A6)

    // MARK: - Accents
    static let amber = Color(hex: 0xF2B765)
    static let user = Color(hex: 0x7CC4FF)
    static let tool = Color(hex: 0xA78BFA)
    static let running = Color(hex: 0x4ED7A0)
    static let blocked = Color(hex: 0xFF6B6B)

    // MARK: - Fonts (monospaced)
    static let bodyFont = Font.system(size: 13, weight: .regular, design: .monospaced)
    static let chipFont = Font.system(size: 11, weight: .medium, design: .monospaced)
    static let footerFont = Font.system(size: 9, weight: .regular, design: .monospaced)
}

// MARK: - Color(hex:)

extension Color {
    /// Initialize from a 24-bit RGB hex value, e.g. `Color(hex: 0x11151F)`.
    init(hex: UInt) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1.0)
    }
}
