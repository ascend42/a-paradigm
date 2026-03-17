// TilingEngineTests.swift
// Tests for #tiling-engine — layout computation, presets, cell operations.

import XCTest
@testable import Conductor

final class TilingEngineTests: XCTestCase {

    private let testArea = CGRect(x: 0, y: 0, width: 1000, height: 800)

    // MARK: - Cell Count

    func testSingleCellCount() {
        let root = TileNode.cell(.empty())
        XCTAssertEqual(TilingEngine.cellCount(root), 1)
    }

    func testSplitCellCount() {
        let root = TileNode.split(SplitState(
            axis: .horizontal,
            first: .cell(.empty()),
            second: .cell(.empty())
        ))
        XCTAssertEqual(TilingEngine.cellCount(root), 2)
    }

    func testNestedSplitCellCount() {
        let root = TileNode.split(SplitState(
            axis: .horizontal,
            first: .cell(.empty()),
            second: .split(SplitState(
                axis: .vertical,
                first: .cell(.empty()),
                second: .cell(.empty())
            ))
        ))
        XCTAssertEqual(TilingEngine.cellCount(root), 3)
    }

    // MARK: - Frame Computation

    func testSingleCellFillsArea() {
        let cell = CellState(id: "test", instanceId: nil, projectPath: nil, label: nil)
        let root = TileNode.cell(cell)
        let frames = TilingEngine.computeFrames(root: root, area: testArea, gap: 0)

        XCTAssertEqual(frames.count, 1)
        XCTAssertEqual(frames[0].frame.width, testArea.width, accuracy: 1)
        XCTAssertEqual(frames[0].frame.height, testArea.height, accuracy: 1)
    }

    func testHorizontalSplitDivides() {
        let root = TileNode.split(SplitState(
            axis: .horizontal,
            ratio: 0.5,
            first: .cell(CellState(id: "a", instanceId: nil, projectPath: nil, label: nil)),
            second: .cell(CellState(id: "b", instanceId: nil, projectPath: nil, label: nil))
        ))
        let frames = TilingEngine.computeFrames(root: root, area: testArea, gap: 8)

        XCTAssertEqual(frames.count, 2)
        // Both should be roughly half width minus gap
        let totalWidth = frames[0].frame.width + frames[1].frame.width + 8
        XCTAssertEqual(totalWidth, testArea.width, accuracy: 1)
    }

    func testVerticalSplitDivides() {
        let root = TileNode.split(SplitState(
            axis: .vertical,
            ratio: 0.5,
            first: .cell(CellState(id: "a", instanceId: nil, projectPath: nil, label: nil)),
            second: .cell(CellState(id: "b", instanceId: nil, projectPath: nil, label: nil))
        ))
        let frames = TilingEngine.computeFrames(root: root, area: testArea, gap: 8)

        XCTAssertEqual(frames.count, 2)
        let totalHeight = frames[0].frame.height + frames[1].frame.height + 8
        XCTAssertEqual(totalHeight, testArea.height, accuracy: 1)
    }

    // MARK: - Presets

    func testFocusedPreset() {
        let cells = [CellState(id: "a", instanceId: "inst-1", projectPath: "/test", label: "Test")]
        let root = TilingEngine.preset(.focused, cells: cells)
        XCTAssertEqual(TilingEngine.cellCount(root), 1)
    }

    func testGridPreset() {
        let cells = (0..<4).map { CellState(id: "c\($0)", instanceId: nil, projectPath: nil, label: nil) }
        let root = TilingEngine.preset(.grid, cells: cells)
        XCTAssertEqual(TilingEngine.cellCount(root), 4)
    }

    func testTriplePreset() {
        let cells = (0..<3).map { CellState(id: "c\($0)", instanceId: nil, projectPath: nil, label: nil) }
        let root = TilingEngine.preset(.triple, cells: cells)
        XCTAssertEqual(TilingEngine.cellCount(root), 3)
    }

    func testPresetPadsEmptyCells() {
        let cells = [CellState(id: "a", instanceId: "inst-1", projectPath: nil, label: nil)]
        let root = TilingEngine.preset(.grid, cells: cells)
        XCTAssertEqual(TilingEngine.cellCount(root), 4)
        // First cell should have instanceId, rest should be empty
        let allCells = TilingEngine.allCells(root)
        XCTAssertNotNil(allCells[0].instanceId)
        XCTAssertNil(allCells[1].instanceId)
    }

    // MARK: - Cell Operations

    func testSplitCell() {
        let cell = CellState(id: "target", instanceId: "inst-1", projectPath: nil, label: nil)
        let root = TileNode.cell(cell)

        let split = TilingEngine.splitCell(in: root, cellId: "target", axis: .horizontal)
        XCTAssertEqual(TilingEngine.cellCount(split), 2)
    }

    func testRemoveCell() {
        let root = TileNode.split(SplitState(
            axis: .horizontal,
            first: .cell(CellState(id: "keep", instanceId: nil, projectPath: nil, label: nil)),
            second: .cell(CellState(id: "remove", instanceId: nil, projectPath: nil, label: nil))
        ))

        let result = TilingEngine.removeCell(in: root, cellId: "remove")
        XCTAssertEqual(TilingEngine.cellCount(result), 1)
        XCTAssertEqual(TilingEngine.allCells(result)[0].id, "keep")
    }

    func testUpdateRatio() {
        let root = TileNode.split(SplitState(
            axis: .horizontal,
            ratio: 0.5,
            first: .cell(.empty()),
            second: .cell(.empty())
        ))

        if case .split(let state) = root {
            let updated = TilingEngine.updateRatio(in: root, splitId: state.id, ratio: 0.7)
            if case .split(let newState) = updated {
                XCTAssertEqual(newState.ratio, 0.7, accuracy: 0.01)
            } else {
                XCTFail("Expected split")
            }
        }
    }

    func testRatioClamping() {
        let root = TileNode.split(SplitState(
            axis: .horizontal,
            ratio: 0.5,
            first: .cell(.empty()),
            second: .cell(.empty())
        ))

        if case .split(let state) = root {
            // Try extreme ratio — should clamp
            let updated = TilingEngine.updateRatio(in: root, splitId: state.id, ratio: 0.05)
            if case .split(let newState) = updated {
                XCTAssertGreaterThanOrEqual(newState.ratio, 0.15)
            }
        }
    }

    // MARK: - Dividers

    func testDividerCount() {
        let root = TileNode.split(SplitState(
            axis: .horizontal,
            first: .cell(.empty()),
            second: .split(SplitState(
                axis: .vertical,
                first: .cell(.empty()),
                second: .cell(.empty())
            ))
        ))

        let dividers = TilingEngine.computeDividers(root: root, area: testArea)
        XCTAssertEqual(dividers.count, 2) // One horizontal, one vertical
    }

    // MARK: - Swap

    func testSwapCells() {
        let cellA = CellState(id: "a", instanceId: "inst-1", projectPath: "/proj-a", label: "A")
        let cellB = CellState(id: "b", instanceId: "inst-2", projectPath: "/proj-b", label: "B")
        let root = TileNode.split(SplitState(
            axis: .horizontal,
            first: .cell(cellA),
            second: .cell(cellB)
        ))

        let swapped = TilingEngine.swapCells(in: root, cellA: "a", cellB: "b")
        let cells = TilingEngine.allCells(swapped)
        // After swap: cell "a" should have B's content, cell "b" should have A's content
        XCTAssertEqual(cells[0].instanceId, "inst-2")
        XCTAssertEqual(cells[1].instanceId, "inst-1")
    }
}
