// GazeCalibrationTests.swift
// Tests for #gaze-calibration affine mapping, least-squares, and calibration diagnostics.

import XCTest
@testable import Conductor

@MainActor
final class GazeCalibrationTests: XCTestCase {

    func testHasCalibrationFalseByDefault() {
        let cal = GazeCalibration()
        XCTAssertFalse(cal.hasCalibration)
    }

    func testHasCalibrationRequires3Points() {
        let cal = GazeCalibration()
        cal.addCalibrationPoint(iris: CGPoint(x: 0.1, y: 0.1), screen: CGPoint(x: 100, y: 100))
        XCTAssertFalse(cal.hasCalibration, "Need at least 3 points for affine")

        cal.addCalibrationPoint(iris: CGPoint(x: 0.9, y: 0.1), screen: CGPoint(x: 1800, y: 100))
        XCTAssertFalse(cal.hasCalibration, "Still only 2 points")

        cal.addCalibrationPoint(iris: CGPoint(x: 0.5, y: 0.9), screen: CGPoint(x: 960, y: 980))
        XCTAssertTrue(cal.hasCalibration, "3 points should enable affine")
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

    func testLeastSquaresWith5Points() {
        let cal = GazeCalibration()
        // 5-point calibration with a known linear mapping:
        // screen_x = 1920 * (1 - iris_x), screen_y = 1080 * iris_y
        cal.addCalibrationPoint(iris: CGPoint(x: 0.5, y: 0.5), screen: CGPoint(x: 960, y: 540))
        cal.addCalibrationPoint(iris: CGPoint(x: 0.1, y: 0.9), screen: CGPoint(x: 1728, y: 972))
        cal.addCalibrationPoint(iris: CGPoint(x: 0.9, y: 0.9), screen: CGPoint(x: 192, y: 972))
        cal.addCalibrationPoint(iris: CGPoint(x: 0.1, y: 0.1), screen: CGPoint(x: 1728, y: 108))
        cal.addCalibrationPoint(iris: CGPoint(x: 0.9, y: 0.1), screen: CGPoint(x: 192, y: 108))

        XCTAssertTrue(cal.hasCalibration)

        // Test mapping at a point not used in calibration
        let result = cal.mapToScreen(CGPoint(x: 0.3, y: 0.7))
        XCTAssertEqual(result.x, 1344, accuracy: 2.0)  // 1920 * 0.7
        XCTAssertEqual(result.y, 756, accuracy: 2.0)    // 1080 * 0.7
    }

    func testCalibrationQualityPerfectMapping() {
        let cal = GazeCalibration()
        cal.addCalibrationPoint(iris: CGPoint(x: 0, y: 0), screen: CGPoint(x: 0, y: 0))
        cal.addCalibrationPoint(iris: CGPoint(x: 1, y: 0), screen: CGPoint(x: 1920, y: 0))
        cal.addCalibrationPoint(iris: CGPoint(x: 0, y: 1), screen: CGPoint(x: 0, y: 1080))

        let quality = cal.calibrationQuality()
        XCTAssertNotNil(quality)
        // Perfect affine should have ~zero residual
        XCTAssertEqual(quality!, 0, accuracy: 0.1)
    }

    func testCalibrationQualityNilWhenUncalibrated() {
        let cal = GazeCalibration()
        XCTAssertNil(cal.calibrationQuality())
    }

    func testResiduals() {
        let cal = GazeCalibration()
        cal.addCalibrationPoint(iris: CGPoint(x: 0, y: 0), screen: CGPoint(x: 0, y: 0))
        cal.addCalibrationPoint(iris: CGPoint(x: 1, y: 0), screen: CGPoint(x: 1920, y: 0))
        cal.addCalibrationPoint(iris: CGPoint(x: 0, y: 1), screen: CGPoint(x: 0, y: 1080))

        let residuals = cal.residuals()
        XCTAssertEqual(residuals.count, 3)
        for r in residuals {
            XCTAssertEqual(r.error, 0, accuracy: 0.1, "Perfect mapping should have zero residual")
        }
    }

    func testResetClearsCalibration() {
        let cal = GazeCalibration()
        cal.addCalibrationPoint(iris: CGPoint(x: 0, y: 0), screen: CGPoint(x: 0, y: 0))
        cal.addCalibrationPoint(iris: CGPoint(x: 1, y: 0), screen: CGPoint(x: 1920, y: 0))
        cal.addCalibrationPoint(iris: CGPoint(x: 0, y: 1), screen: CGPoint(x: 0, y: 1080))
        XCTAssertTrue(cal.hasCalibration)

        cal.reset()
        XCTAssertFalse(cal.hasCalibration)
        XCTAssertNil(cal.calibrationQuality())
    }
}
