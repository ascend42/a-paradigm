// GazeCalibrationTests.swift
// Tests for #gaze-calibration affine mapping and calibration state.

import XCTest
@testable import Conductor

@MainActor
final class GazeCalibrationTests: XCTestCase {

    func testHasCalibrationFalseByDefault() {
        let cal = GazeCalibration()
        XCTAssertFalse(cal.hasCalibration)
    }

    func testHasCalibrationTrueAfterAddingPoints() {
        let cal = GazeCalibration()
        cal.addCalibrationPoint(iris: CGPoint(x: 0.1, y: 0.1), screen: CGPoint(x: 100, y: 100))
        XCTAssertTrue(cal.hasCalibration)
    }

    func testMapFallsBackWithFewerThan3Points() {
        let cal = GazeCalibration()
        cal.addCalibrationPoint(iris: CGPoint(x: 0.5, y: 0.5), screen: CGPoint(x: 960, y: 540))
        cal.addCalibrationPoint(iris: CGPoint(x: 0.1, y: 0.1), screen: CGPoint(x: 100, y: 100))

        // With <3 points, mapToScreen uses simpleMap — result should still be valid CGPoint
        let result = cal.mapToScreen(CGPoint(x: 0.5, y: 0.5))
        XCTAssertFalse(result.x.isNaN)
        XCTAssertFalse(result.y.isNaN)
    }

    func testAffineMapWith3Points() {
        let cal = GazeCalibration()
        // Identity-like calibration: iris coords map directly to screen coords
        cal.addCalibrationPoint(iris: CGPoint(x: 0, y: 0), screen: CGPoint(x: 0, y: 0))
        cal.addCalibrationPoint(iris: CGPoint(x: 1, y: 0), screen: CGPoint(x: 1920, y: 0))
        cal.addCalibrationPoint(iris: CGPoint(x: 0, y: 1), screen: CGPoint(x: 0, y: 1080))

        let result = cal.mapToScreen(CGPoint(x: 0.5, y: 0.5))
        XCTAssertEqual(result.x, 960, accuracy: 1.0)
        XCTAssertEqual(result.y, 540, accuracy: 1.0)
    }

    func testAffineMapWithScaling() {
        let cal = GazeCalibration()
        // 2x scaling in X, 3x in Y
        cal.addCalibrationPoint(iris: CGPoint(x: 0, y: 0), screen: CGPoint(x: 0, y: 0))
        cal.addCalibrationPoint(iris: CGPoint(x: 1, y: 0), screen: CGPoint(x: 2, y: 0))
        cal.addCalibrationPoint(iris: CGPoint(x: 0, y: 1), screen: CGPoint(x: 0, y: 3))

        let result = cal.mapToScreen(CGPoint(x: 1, y: 1))
        XCTAssertEqual(result.x, 2, accuracy: 0.001)
        XCTAssertEqual(result.y, 3, accuracy: 0.001)
    }

    func testResetClearsCalibration() {
        let cal = GazeCalibration()
        cal.addCalibrationPoint(iris: CGPoint(x: 0.5, y: 0.5), screen: CGPoint(x: 960, y: 540))
        XCTAssertTrue(cal.hasCalibration)

        cal.reset()
        XCTAssertFalse(cal.hasCalibration)
    }
}
