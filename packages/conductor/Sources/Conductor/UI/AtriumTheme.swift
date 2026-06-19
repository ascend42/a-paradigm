// AtriumTheme.swift — #atrium-theme
// Visual tokens for the ATRIUM custom thread. A deep, calm, mono palette distinct
// from the rest of Conductor's system-colored UI — this is the keystone surface.
//
// TYPE SCALE (one source of truth): every ATRIUM/cockpit font flows through the
// named helpers below (`bodyFont`, `monoFont`, `labelFont`, `microFont`, plus the
// prose `prose…` system-font helpers used by the spine + chorus rows). Each helper
// multiplies its baseline point size by `AtriumTheme.fontScale` — a user-adjustable
// multiplier persisted in @AppStorage("atriumFontScale"), driven live by ⌘= / ⌘-
// (see AppDelegate.handleZoomIn/handleZoomOut + AtriumFontScale). Views read the
// same @AppStorage so SwiftUI re-renders when the founder zooms.

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

    // MARK: - Type scale (baselines)
    //
    // Comfortable readable baselines (the founder found the old 9–13pt scale tiny).
    // body ≈ conversation / decision prose, mono ≈ code & tool chips,
    // label ≈ option labels / chips / status, micro ≈ footer / captions / subtitles.
    // These are the *baseline* sizes; the effective size = baseline × fontScale.
    enum Size {
        static let body: CGFloat = 15      // agent/user prose, decision question
        static let mono: CGFloat = 13.5    // code spans, tool chips, mono labels
        static let label: CGFloat = 12.5   // option labels, chips, buttons, status
        static let micro: CGFloat = 11     // footer, captions, subtitles, hints
    }

    // MARK: - User-adjustable scale
    //
    // Single source of truth for the live multiplier. Read straight from
    // UserDefaults so the static font helpers (which aren't SwiftUI views) pick up
    // the current value; views additionally hold an @AppStorage("atriumFontScale")
    // so SwiftUI invalidates + re-renders them when the founder zooms.
    static var fontScale: CGFloat {
        let raw = UserDefaults.standard.double(forKey: AtriumFontScale.key)
        return AtriumFontScale.clamp(raw == 0 ? AtriumFontScale.defaultValue : raw)
    }

    /// Scale a baseline point size by the current user multiplier.
    static func scaled(_ size: CGFloat) -> CGFloat { (size * fontScale).rounded() }

    // MARK: - Fonts (monospaced) — scaled
    static var bodyFont: Font   { .system(size: scaled(Size.body),  weight: .regular, design: .monospaced) }
    static var monoFont: Font   { .system(size: scaled(Size.mono),  weight: .regular, design: .monospaced) }
    static var chipFont: Font   { .system(size: scaled(Size.label), weight: .medium,  design: .monospaced) }
    static var footerFont: Font { .system(size: scaled(Size.micro), weight: .regular, design: .monospaced) }

    // MARK: - Prose fonts (system / Inter-ish) — scaled
    //
    // The spine + chorus rows lead with prose in the system font (description /
    // projectName). Centralized here so they scale with everything else instead of
    // carrying inline `.system(size: 12)` magic numbers.
    static func prose(_ size: CGFloat = Size.label, weight: Font.Weight = .medium) -> Font {
        .system(size: scaled(size), weight: weight)
    }
    /// Glyph helper (status dots, carets) — bold, scaled off the label baseline.
    static func glyphFont(_ size: CGFloat = 11, weight: Font.Weight = .bold) -> Font {
        .system(size: scaled(size), weight: weight)
    }
}

// MARK: - AtriumFontScale (user-adjustable multiplier)

/// The live, persisted ATRIUM/cockpit font multiplier. ⌘= / ⌘- nudge it; views
/// observe it via @AppStorage(AtriumFontScale.key). Clamped to a sane range so the
/// cockpit can't be zoomed into uselessness. To expose a slider, bind a control to
/// @AppStorage("atriumFontScale") over the range `range`.
enum AtriumFontScale {
    static let key = "atriumFontScale"
    static let defaultValue: CGFloat = 1.0
    static let step: CGFloat = 0.1
    static let minValue: CGFloat = 0.8
    static let maxValue: CGFloat = 1.6
    static var range: ClosedRange<CGFloat> { minValue...maxValue }

    static func clamp(_ v: CGFloat) -> CGFloat { min(maxValue, max(minValue, v)) }

    private static var current: CGFloat {
        let raw = UserDefaults.standard.double(forKey: key)
        return clamp(raw == 0 ? defaultValue : CGFloat(raw))
    }

    /// Nudge up one step (⌘=). Returns the new clamped value.
    @discardableResult
    static func increase() -> CGFloat { set(current + step) }

    /// Nudge down one step (⌘-). Returns the new clamped value.
    @discardableResult
    static func decrease() -> CGFloat { set(current - step) }

    @discardableResult
    static func set(_ v: CGFloat) -> CGFloat {
        let clamped = clamp(v)
        UserDefaults.standard.set(Double(clamped), forKey: key)
        return clamped
    }
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
