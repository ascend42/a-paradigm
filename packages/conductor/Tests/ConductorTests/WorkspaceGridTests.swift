// WorkspaceGridTests.swift
// Tests for #workspace-grid cell computation, sidebar positioning, and point-to-cell mapping.

import XCTest
@testable import Conductor

final class WorkspaceGridTests: XCTestCase {

    private let screen = CGRect(x: 0, y: 0, width: 1920, height: 1080)

    private func makeGrid(instances: Int, side: WorkspaceGrid.SidebarSide = .left, width: CGFloat = 320) -> WorkspaceGrid {
        WorkspaceGrid(
            screenBounds: screen,
            sidebarWidth: width,
            sidebarSide: side,
            instanceCount: instances,
            gap: 4
        )
    }

    // MARK: - Single Instance

    func testSingleInstanceUsesFullArea() {
        let grid = makeGrid(instances: 1)
        let cell = grid.cellFrame(at: 0)
        // Should fill available area (screen minus sidebar)
        XCTAssertEqual(cell.width, screen.width - 320 - 4, accuracy: 1)
        XCTAssertEqual(cell.height, screen.height, accuracy: 1)
    }

    // MARK: - Two Instances

    func testTwoInstancesSideBySide() {
        let grid = makeGrid(instances: 2)
        let cell0 = grid.cellFrame(at: 0)
        let cell1 = grid.cellFrame(at: 1)

        // Both cells should have equal width
        XCTAssertEqual(cell0.width, cell1.width, accuracy: 1)
        // Cells should not overlap
        XCTAssertTrue(cell0.maxX <= cell1.minX + 5) // gap allowance
    }

    // MARK: - Three Instances (2+1)

    func testThreeInstances2Plus1() {
        let grid = makeGrid(instances: 3)
        let cell0 = grid.cellFrame(at: 0)
        let cell1 = grid.cellFrame(at: 1)
        let cell2 = grid.cellFrame(at: 2) // bottom row, full width

        // Bottom cell should be wider than top cells
        XCTAssertGreaterThan(cell2.width, cell0.width)
    }

    // MARK: - Four Instances (2x2 Grid)

    func testFourInstancesGrid() {
        let grid = makeGrid(instances: 4)
        let frames = grid.allCellFrames()
        XCTAssertEqual(frames.count, 4)

        // All cells should have approximately equal dimensions
        for frame in frames {
            XCTAssertEqual(frame.width, frames[0].width, accuracy: 1)
            XCTAssertEqual(frame.height, frames[0].height, accuracy: 1)
        }
    }

    // MARK: - Sidebar Position

    func testLeftSidebar() {
        let grid = makeGrid(instances: 1, side: .left)
        let sidebar = grid.sidebarFrame
        let cell = grid.cellFrame(at: 0)
        // Sidebar on left, cells on right
        XCTAssertEqual(sidebar.minX, screen.minX, accuracy: 1)
        XCTAssertGreaterThan(cell.minX, sidebar.maxX)
    }

    func testRightSidebar() {
        let grid = makeGrid(instances: 1, side: .right)
        let sidebar = grid.sidebarFrame
        let cell = grid.cellFrame(at: 0)
        // Sidebar on right, cells on left
        XCTAssertEqual(cell.minX, screen.minX, accuracy: 1)
        XCTAssertLessThan(cell.maxX, sidebar.minX + 5)
    }

    // MARK: - Point-to-Cell Mapping

    func testPointInCell() {
        let grid = makeGrid(instances: 2)
        let cell0 = grid.cellFrame(at: 0)
        let center0 = CGPoint(x: cell0.midX, y: cell0.midY)
        XCTAssertEqual(grid.cellIndex(for: center0), 0)
    }

    func testPointInSidebarReturnsNil() {
        let grid = makeGrid(instances: 2, side: .left)
        let sidebarCenter = CGPoint(x: grid.sidebarFrame.midX, y: grid.sidebarFrame.midY)
        XCTAssertNil(grid.cellIndex(for: sidebarCenter))
    }

    func testPointOutsideAllCellsReturnsNil() {
        let grid = makeGrid(instances: 1)
        let outside = CGPoint(x: -100, y: -100)
        XCTAssertNil(grid.cellIndex(for: outside))
    }

    // MARK: - Available Frame

    func testAvailableFrameExcludesSidebar() {
        let grid = makeGrid(instances: 1, side: .left, width: 400)
        let available = grid.availableFrame
        XCTAssertEqual(available.width, screen.width - 400 - 4, accuracy: 1)
    }
}
