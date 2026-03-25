// WorkspaceGrid.swift — #workspace-grid
// Pure struct computing deterministic grid cell frames from screen geometry.
// Supports explicit NxM grid configurations (1x1, 1x2, 2x2, 3x2, etc.)
// Used for terminal window placement and gaze zone targeting.

import Foundation

/// A grid layout preset with explicit column and row counts.
struct GridPreset: Equatable, Hashable, Codable {
    let columns: Int
    let rows: Int

    var label: String { "\(columns)x\(rows)" }
    var totalCells: Int { columns * rows }

    static let oneByOne = GridPreset(columns: 1, rows: 1)
    static let oneByTwo = GridPreset(columns: 1, rows: 2)
    static let twoByOne = GridPreset(columns: 2, rows: 1)
    static let twoByTwo = GridPreset(columns: 2, rows: 2)
    static let threeByTwo = GridPreset(columns: 3, rows: 2)
    static let threeByOne = GridPreset(columns: 3, rows: 1)

    /// All available presets in display order.
    static let allPresets: [GridPreset] = [
        .oneByOne, .twoByOne, .oneByTwo, .twoByTwo, .threeByOne, .threeByTwo,
    ]
}

// MARK: - RawRepresentable (for @AppStorage persistence)

extension GridPreset: RawRepresentable {
    init?(rawValue: String) {
        let parts = rawValue.split(separator: "x")
        guard parts.count == 2,
              let cols = Int(parts[0]),
              let rows = Int(parts[1]) else {
            return nil
        }
        self.init(columns: cols, rows: rows)
    }

    var rawValue: String { "\(columns)x\(rows)" }
}

/// Computes cell frames for a workspace grid layout.
struct WorkspaceGrid: Equatable {

    /// Which side the Conductor sidebar is on.
    enum SidebarSide: String, CaseIterable, Codable {
        case left
        case right
    }

    // MARK: - Configuration

    let screenBounds: CGRect
    let sidebarWidth: CGFloat
    let sidebarSide: SidebarSide
    let preset: GridPreset
    let gap: CGFloat

    /// Convenience initializer that auto-calculates grid from instance count (legacy behavior).
    init(screenBounds: CGRect, sidebarWidth: CGFloat, sidebarSide: SidebarSide, instanceCount: Int, gap: CGFloat) {
        self.screenBounds = screenBounds
        self.sidebarWidth = sidebarWidth
        self.sidebarSide = sidebarSide
        self.gap = gap

        // Auto-calculate grid from instance count
        switch instanceCount {
        case 0, 1: self.preset = .oneByOne
        case 2: self.preset = .twoByOne
        case 3, 4: self.preset = .twoByTwo
        case 5, 6: self.preset = .threeByTwo
        default: self.preset = .threeByTwo
        }
    }

    /// Explicit grid initializer — use when the user picks a preset.
    init(screenBounds: CGRect, sidebarWidth: CGFloat, sidebarSide: SidebarSide, preset: GridPreset, gap: CGFloat) {
        self.screenBounds = screenBounds
        self.sidebarWidth = sidebarWidth
        self.sidebarSide = sidebarSide
        self.preset = preset
        self.gap = gap
    }

    // MARK: - Computed

    var columns: Int { preset.columns }
    var rows: Int { preset.rows }

    /// The frame available for grid cells (screen minus sidebar).
    var availableFrame: CGRect {
        switch sidebarSide {
        case .left:
            return CGRect(
                x: screenBounds.minX + sidebarWidth + gap,
                y: screenBounds.minY,
                width: screenBounds.width - sidebarWidth - gap,
                height: screenBounds.height
            )
        case .right:
            return CGRect(
                x: screenBounds.minX,
                y: screenBounds.minY,
                width: screenBounds.width - sidebarWidth - gap,
                height: screenBounds.height
            )
        }
    }

    /// The frame for the Conductor sidebar.
    var sidebarFrame: CGRect {
        switch sidebarSide {
        case .left:
            return CGRect(
                x: screenBounds.minX,
                y: screenBounds.minY,
                width: sidebarWidth,
                height: screenBounds.height
            )
        case .right:
            return CGRect(
                x: screenBounds.maxX - sidebarWidth,
                y: screenBounds.minY,
                width: sidebarWidth,
                height: screenBounds.height
            )
        }
    }

    // MARK: - Cell Computation

    /// Get the frame for a specific grid cell index.
    /// Cells are ordered left-to-right, top-to-bottom.
    func cellFrame(at index: Int) -> CGRect {
        guard index < preset.totalCells else {
            return availableFrame
        }

        let area = availableFrame

        let cellWidth = (area.width - CGFloat(columns - 1) * gap) / CGFloat(columns)
        let cellHeight = (area.height - CGFloat(rows - 1) * gap) / CGFloat(rows)

        let col = index % columns
        let row = index / columns

        return CGRect(
            x: area.minX + CGFloat(col) * (cellWidth + gap),
            y: area.maxY - CGFloat(row + 1) * cellHeight - CGFloat(row) * gap,
            width: cellWidth,
            height: cellHeight
        )
    }

    /// All cell frames for the current grid configuration.
    func allCellFrames() -> [CGRect] {
        (0..<preset.totalCells).map { cellFrame(at: $0) }
    }

    /// Find which cell index contains the given screen point.
    /// Returns nil if the point is in the sidebar or outside all cells.
    func cellIndex(for point: CGPoint) -> Int? {
        // Check sidebar exclusion
        if sidebarFrame.contains(point) { return nil }

        // Check each cell
        for i in 0..<preset.totalCells {
            if cellFrame(at: i).contains(point) {
                return i
            }
        }
        return nil
    }
}
