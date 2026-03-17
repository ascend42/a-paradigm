// TilingEngine.swift — #tiling-engine
// Binary split tree layout engine for the workspace container.
// Replaces fixed 2-column WorkspaceGrid with flexible tiling.

import Foundation

// MARK: - Tile Node (recursive tree)

/// A node in the tiling layout tree.
indirect enum TileNode: Identifiable, Equatable {
    /// A leaf cell containing an instance (or empty placeholder).
    case cell(CellState)
    /// A split into two children with a configurable ratio.
    case split(SplitState)

    var id: String {
        switch self {
        case .cell(let state): return state.id
        case .split(let state): return state.id
        }
    }
}

// MARK: - Cell State

/// A leaf cell in the tiling tree.
struct CellState: Identifiable, Equatable, Codable {
    let id: String
    var instanceId: String?
    var projectPath: String?
    var label: String?

    static func empty() -> CellState {
        CellState(id: UUID().uuidString, instanceId: nil, projectPath: nil, label: nil)
    }

    var isEmpty: Bool { instanceId == nil }
}

// MARK: - Split State

/// An internal node splitting space between two children.
struct SplitState: Identifiable, Equatable {
    let id: String
    var axis: SplitAxis
    var ratio: CGFloat  // 0.0–1.0, where ratio is the proportion given to `first`
    var first: TileNode
    var second: TileNode

    init(axis: SplitAxis, ratio: CGFloat = 0.5, first: TileNode, second: TileNode) {
        self.id = UUID().uuidString
        self.axis = axis
        self.ratio = min(max(ratio, 0.15), 0.85) // Clamp to prevent invisible cells
        self.first = first
        self.second = second
    }
}

/// Split direction.
enum SplitAxis: String, Codable {
    case horizontal // left | right
    case vertical   // top / bottom
}

// MARK: - Layout Computation

/// Computed frame for a cell in the tiling tree.
struct CellFrame: Identifiable {
    let id: String       // CellState.id
    let frame: CGRect
    let instanceId: String?
    let label: String?
    let projectPath: String?
}

/// Divider handle between two cells.
struct DividerFrame: Identifiable {
    let id: String       // SplitState.id
    let frame: CGRect
    let axis: SplitAxis
}

extension TilingEngine {

    /// Compute all cell frames for a given available area.
    static func computeFrames(root: TileNode, area: CGRect, gap: CGFloat = 8) -> [CellFrame] {
        var results: [CellFrame] = []
        computeFramesRecursive(node: root, area: area, gap: gap, results: &results)
        return results
    }

    private static func computeFramesRecursive(
        node: TileNode,
        area: CGRect,
        gap: CGFloat,
        results: inout [CellFrame]
    ) {
        switch node {
        case .cell(let state):
            results.append(CellFrame(
                id: state.id,
                frame: area,
                instanceId: state.instanceId,
                label: state.label,
                projectPath: state.projectPath
            ))

        case .split(let state):
            let (firstArea, secondArea) = splitArea(area, axis: state.axis, ratio: state.ratio, gap: gap)
            computeFramesRecursive(node: state.first, area: firstArea, gap: gap, results: &results)
            computeFramesRecursive(node: state.second, area: secondArea, gap: gap, results: &results)
        }
    }

    /// Compute all divider frames for drag handles.
    static func computeDividers(root: TileNode, area: CGRect, gap: CGFloat = 8) -> [DividerFrame] {
        var results: [DividerFrame] = []
        computeDividersRecursive(node: root, area: area, gap: gap, results: &results)
        return results
    }

    private static func computeDividersRecursive(
        node: TileNode,
        area: CGRect,
        gap: CGFloat,
        results: inout [DividerFrame]
    ) {
        guard case .split(let state) = node else { return }

        let dividerFrame: CGRect
        switch state.axis {
        case .horizontal:
            let splitX = area.minX + area.width * state.ratio
            dividerFrame = CGRect(x: splitX - gap / 2, y: area.minY, width: gap, height: area.height)
        case .vertical:
            let splitY = area.minY + area.height * (1 - state.ratio)
            dividerFrame = CGRect(x: area.minX, y: splitY - gap / 2, width: area.width, height: gap)
        }

        results.append(DividerFrame(id: state.id, frame: dividerFrame, axis: state.axis))

        let (firstArea, secondArea) = splitArea(area, axis: state.axis, ratio: state.ratio, gap: gap)
        computeDividersRecursive(node: state.first, area: firstArea, gap: gap, results: &results)
        computeDividersRecursive(node: state.second, area: secondArea, gap: gap, results: &results)
    }

    /// Split an area into two sub-areas.
    private static func splitArea(
        _ area: CGRect,
        axis: SplitAxis,
        ratio: CGFloat,
        gap: CGFloat
    ) -> (CGRect, CGRect) {
        switch axis {
        case .horizontal:
            let firstWidth = (area.width - gap) * ratio
            let secondWidth = area.width - gap - firstWidth
            let first = CGRect(x: area.minX, y: area.minY, width: firstWidth, height: area.height)
            let second = CGRect(x: area.minX + firstWidth + gap, y: area.minY, width: secondWidth, height: area.height)
            return (first, second)

        case .vertical:
            let firstHeight = (area.height - gap) * ratio
            let secondHeight = area.height - gap - firstHeight
            // macOS: first (top) has higher Y, second (bottom) has lower Y
            let first = CGRect(x: area.minX, y: area.minY + secondHeight + gap, width: area.width, height: firstHeight)
            let second = CGRect(x: area.minX, y: area.minY, width: area.width, height: secondHeight)
            return (first, second)
        }
    }
}

// MARK: - Tiling Engine

/// Namespace for tiling operations.
enum TilingEngine {

    // MARK: - Presets

    /// Apply a layout preset, preserving existing cell states.
    static func preset(_ preset: LayoutPreset, cells: [CellState]) -> TileNode {
        // Ensure we have enough cells
        var padded = cells
        while padded.count < preset.minCells {
            padded.append(.empty())
        }

        switch preset {
        case .focused:
            return .cell(padded[0])

        case .split:
            return .split(SplitState(
                axis: .horizontal,
                ratio: 0.5,
                first: .cell(padded[0]),
                second: .cell(padded.count > 1 ? padded[1] : .empty())
            ))

        case .mainSide:
            return .split(SplitState(
                axis: .horizontal,
                ratio: 0.6,
                first: .cell(padded[0]),
                second: .cell(padded.count > 1 ? padded[1] : .empty())
            ))

        case .grid:
            return .split(SplitState(
                axis: .vertical,
                ratio: 0.5,
                first: .split(SplitState(
                    axis: .horizontal,
                    ratio: 0.5,
                    first: .cell(padded[0]),
                    second: .cell(padded.count > 1 ? padded[1] : .empty())
                )),
                second: .split(SplitState(
                    axis: .horizontal,
                    ratio: 0.5,
                    first: .cell(padded.count > 2 ? padded[2] : .empty()),
                    second: .cell(padded.count > 3 ? padded[3] : .empty())
                ))
            ))

        case .triple:
            return .split(SplitState(
                axis: .horizontal,
                ratio: 0.6,
                first: .cell(padded[0]),
                second: .split(SplitState(
                    axis: .vertical,
                    ratio: 0.5,
                    first: .cell(padded.count > 1 ? padded[1] : .empty()),
                    second: .cell(padded.count > 2 ? padded[2] : .empty())
                ))
            ))

        case .columns:
            return .split(SplitState(
                axis: .horizontal,
                ratio: 0.333,
                first: .cell(padded[0]),
                second: .split(SplitState(
                    axis: .horizontal,
                    ratio: 0.5,
                    first: .cell(padded.count > 1 ? padded[1] : .empty()),
                    second: .cell(padded.count > 2 ? padded[2] : .empty())
                ))
            ))
        }
    }

    // MARK: - Tree Operations

    /// Collect all leaf cells from the tree.
    static func allCells(_ node: TileNode) -> [CellState] {
        switch node {
        case .cell(let state):
            return [state]
        case .split(let state):
            return allCells(state.first) + allCells(state.second)
        }
    }

    /// Count leaf cells.
    static func cellCount(_ node: TileNode) -> Int {
        switch node {
        case .cell: return 1
        case .split(let state): return cellCount(state.first) + cellCount(state.second)
        }
    }

    /// Find the cell containing a given point.
    static func cellAt(point: CGPoint, root: TileNode, area: CGRect, gap: CGFloat = 8) -> CellState? {
        let frames = computeFrames(root: root, area: area, gap: gap)
        return frames.first { $0.frame.contains(point) }.flatMap { frame in
            allCells(root).first { $0.id == frame.id }
        }
    }

    /// Split a cell into two, replacing it in the tree.
    static func splitCell(
        in root: TileNode,
        cellId: String,
        axis: SplitAxis,
        ratio: CGFloat = 0.5
    ) -> TileNode {
        switch root {
        case .cell(let state):
            if state.id == cellId {
                return .split(SplitState(
                    axis: axis,
                    ratio: ratio,
                    first: .cell(state),
                    second: .cell(.empty())
                ))
            }
            return root

        case .split(var state):
            state.first = splitCell(in: state.first, cellId: cellId, axis: axis, ratio: ratio)
            state.second = splitCell(in: state.second, cellId: cellId, axis: axis, ratio: ratio)
            return .split(state)
        }
    }

    /// Remove a cell from the tree, promoting its sibling.
    static func removeCell(in root: TileNode, cellId: String) -> TileNode {
        switch root {
        case .cell:
            return root // Can't remove the last cell

        case .split(var state):
            // Check if either child is the target
            if case .cell(let first) = state.first, first.id == cellId {
                return state.second
            }
            if case .cell(let second) = state.second, second.id == cellId {
                return state.first
            }

            // Recurse
            state.first = removeCell(in: state.first, cellId: cellId)
            state.second = removeCell(in: state.second, cellId: cellId)
            return .split(state)
        }
    }

    /// Update the ratio of a split node by ID.
    static func updateRatio(in root: TileNode, splitId: String, ratio: CGFloat) -> TileNode {
        switch root {
        case .cell:
            return root

        case .split(var state):
            if state.id == splitId {
                state.ratio = min(max(ratio, 0.15), 0.85)
                return .split(state)
            }
            state.first = updateRatio(in: state.first, splitId: splitId, ratio: ratio)
            state.second = updateRatio(in: state.second, splitId: splitId, ratio: ratio)
            return .split(state)
        }
    }

    /// Swap two cells by their IDs.
    static func swapCells(in root: TileNode, cellA: String, cellB: String) -> TileNode {
        var stateA: CellState?
        var stateB: CellState?
        for cell in allCells(root) {
            if cell.id == cellA { stateA = cell }
            if cell.id == cellB { stateB = cell }
        }
        guard let a = stateA, let b = stateB else { return root }
        return replaceCellState(in: replaceCellState(in: root, cellId: cellA, newState: b), cellId: cellB, newState: a)
    }

    private static func replaceCellState(in root: TileNode, cellId: String, newState: CellState) -> TileNode {
        switch root {
        case .cell(let state):
            if state.id == cellId {
                return .cell(CellState(id: cellId, instanceId: newState.instanceId, projectPath: newState.projectPath, label: newState.label))
            }
            return root
        case .split(var state):
            state.first = replaceCellState(in: state.first, cellId: cellId, newState: newState)
            state.second = replaceCellState(in: state.second, cellId: cellId, newState: newState)
            return .split(state)
        }
    }
}

// MARK: - Layout Presets

enum LayoutPreset: String, CaseIterable {
    case focused  = "Focused"
    case split    = "Split"
    case mainSide = "Main + Side"
    case grid     = "Grid"
    case triple   = "Triple"
    case columns  = "Columns"

    var minCells: Int {
        switch self {
        case .focused: return 1
        case .split, .mainSide: return 2
        case .triple, .columns: return 3
        case .grid: return 4
        }
    }

    var shortcutIndex: Int {
        switch self {
        case .focused: return 1
        case .split: return 2
        case .mainSide: return 3
        case .grid: return 4
        case .triple: return 5
        case .columns: return 6
        }
    }
}
