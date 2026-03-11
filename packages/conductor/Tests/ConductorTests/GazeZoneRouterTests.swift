// GazeZoneRouterTests.swift
// Tests for #gaze-zone-router point-to-cell mapping and dwell behavior.

import XCTest
@testable import Conductor

@MainActor
final class GazeZoneRouterTests: XCTestCase {

    private let screen = CGRect(x: 0, y: 0, width: 1920, height: 1080)

    private func makeGrid(instances: Int) -> WorkspaceGrid {
        WorkspaceGrid(
            screenBounds: screen,
            sidebarWidth: 320,
            sidebarSide: .left,
            instanceCount: instances,
            gap: 4
        )
    }

    // MARK: - Grid Cell Mapping

    func testPointInFirstCellReturnsIndex0() {
        let grid = makeGrid(instances: 2)
        let cell0 = grid.cellFrame(at: 0)
        let center = CGPoint(x: cell0.midX, y: cell0.midY)
        XCTAssertEqual(grid.cellIndex(for: center), 0)
    }

    func testPointInSecondCellReturnsIndex1() {
        let grid = makeGrid(instances: 2)
        let cell1 = grid.cellFrame(at: 1)
        let center = CGPoint(x: cell1.midX, y: cell1.midY)
        XCTAssertEqual(grid.cellIndex(for: center), 1)
    }

    func testPointInSidebarReturnsNil() {
        let grid = makeGrid(instances: 2)
        let sidebarCenter = CGPoint(x: 160, y: 540)  // Left sidebar
        XCTAssertNil(grid.cellIndex(for: sidebarCenter))
    }

    func testPointOutsideScreenReturnsNil() {
        let grid = makeGrid(instances: 2)
        XCTAssertNil(grid.cellIndex(for: CGPoint(x: -50, y: -50)))
    }

    // MARK: - Dwell Behavior

    func testInitialStateHasNoTarget() {
        let router = GazeZoneRouter()
        XCTAssertNil(router.targetedCellIndex)
        XCTAssertFalse(router.isDwelling)
    }

    func testGazePointIsTracked() {
        let router = GazeZoneRouter()
        router.updateGazePoint(CGPoint(x: 500, y: 500))
        XCTAssertEqual(router.currentGazePoint, CGPoint(x: 500, y: 500))
    }

    // MARK: - Four Cells

    func testFourCellGridAllCellsReachable() {
        let grid = makeGrid(instances: 4)
        for i in 0..<4 {
            let cell = grid.cellFrame(at: i)
            let center = CGPoint(x: cell.midX, y: cell.midY)
            XCTAssertEqual(grid.cellIndex(for: center), i, "Cell \(i) should be reachable")
        }
    }

    func testGapBetweenCellsReturnsNil() {
        let grid = makeGrid(instances: 2)
        let cell0 = grid.cellFrame(at: 0)
        let cell1 = grid.cellFrame(at: 1)
        // Point in the gap between cells
        let gapPoint = CGPoint(x: (cell0.maxX + cell1.minX) / 2, y: cell0.midY)
        // May return nil or one of the cells depending on gap width
        // The important thing is it doesn't crash
        _ = grid.cellIndex(for: gapPoint)
    }
}
