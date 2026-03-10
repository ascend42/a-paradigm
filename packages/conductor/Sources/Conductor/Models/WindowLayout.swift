// WindowLayout.swift — #conductor-models
// Window tiling layout configurations.

import Foundation

/// Predefined window layout arrangements.
enum WindowLayout: String, CaseIterable {
    /// Single window takes full screen (minus Conductor panel).
    case focused

    /// Two windows side by side.
    case sideBySide

    /// Three windows: one large left, two stacked right.
    case threeUp

    /// Equal grid (2x2 for 4 windows, etc.).
    case grid
}

/// Computed frame for a window within a layout.
struct LayoutFrame {
    let instanceID: String
    let frame: CGRect
}
