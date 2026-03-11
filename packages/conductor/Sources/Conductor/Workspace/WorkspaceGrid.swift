// WorkspaceGrid.swift — #workspace-grid
// Pure struct computing deterministic grid cell frames from screen geometry.
// Used for terminal window placement and gaze zone targeting.

import Foundation

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
    let instanceCount: Int
    let gap: CGFloat

    // MARK: - Computed

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

    /// Number of columns in the grid.
    var columns: Int {
        switch instanceCount {
        case 0, 1: return 1
        case 2: return 2
        case 3: return 2  // 2+1 layout
        default: return 2
        }
    }

    /// Number of rows in the grid.
    var rows: Int {
        guard instanceCount > 0 else { return 1 }
        return (instanceCount + columns - 1) / columns
    }

    // MARK: - Cell Computation

    /// Get the frame for a specific grid cell index.
    func cellFrame(at index: Int) -> CGRect {
        guard instanceCount > 0, index < instanceCount else {
            return availableFrame
        }

        let area = availableFrame
        let cols = columns
        let rowCount = rows

        let cellWidth = (area.width - CGFloat(cols - 1) * gap) / CGFloat(cols)
        let cellHeight = (area.height - CGFloat(rowCount - 1) * gap) / CGFloat(rowCount)

        let col = index % cols
        let row = index / cols

        // Special case: 3 instances → first row gets 2 cells, second row gets 1 full-width
        if instanceCount == 3 && index == 2 {
            return CGRect(
                x: area.minX,
                y: area.minY, // Bottom row (macOS coordinate system)
                width: area.width,
                height: cellHeight
            )
        }

        return CGRect(
            x: area.minX + CGFloat(col) * (cellWidth + gap),
            y: area.maxY - CGFloat(row + 1) * cellHeight - CGFloat(row) * gap,
            width: cellWidth,
            height: cellHeight
        )
    }

    /// All cell frames for the current instance count.
    func allCellFrames() -> [CGRect] {
        (0..<instanceCount).map { cellFrame(at: $0) }
    }

    /// Find which cell index contains the given screen point.
    /// Returns nil if the point is in the sidebar or outside all cells.
    func cellIndex(for point: CGPoint) -> Int? {
        // Check sidebar exclusion
        if sidebarFrame.contains(point) { return nil }

        // Check each cell
        for i in 0..<instanceCount {
            if cellFrame(at: i).contains(point) {
                return i
            }
        }
        return nil
    }
}
