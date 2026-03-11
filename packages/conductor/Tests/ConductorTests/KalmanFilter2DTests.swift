// KalmanFilter2DTests.swift
// Tests for #kalman-filter 2D coordinate smoothing.

import XCTest
@testable import Conductor

final class KalmanFilter2DTests: XCTestCase {

    func testFirstUpdateReturnsMeasurement() {
        var filter = KalmanFilter2D()
        let point = CGPoint(x: 100, y: 200)
        let result = filter.update(point)
        XCTAssertEqual(result.x, point.x, accuracy: 0.001)
        XCTAssertEqual(result.y, point.y, accuracy: 0.001)
    }

    func testConvergesToStablePoint() {
        var filter = KalmanFilter2D()
        let target = CGPoint(x: 500, y: 300)

        // Feed same point repeatedly — output should converge
        var lastResult = filter.update(target)
        for _ in 0..<20 {
            lastResult = filter.update(target)
        }

        XCTAssertEqual(lastResult.x, target.x, accuracy: 1.0)
        XCTAssertEqual(lastResult.y, target.y, accuracy: 1.0)
    }

    func testSmoothsNoisyInput() {
        var filter = KalmanFilter2D()
        filter.measurementNoise = 2.0

        // Initialize at origin-ish
        _ = filter.update(CGPoint(x: 100, y: 100))

        // Feed noisy measurements around (100, 100)
        let noisy: [CGPoint] = [
            CGPoint(x: 105, y: 95),
            CGPoint(x: 98, y: 103),
            CGPoint(x: 102, y: 97),
            CGPoint(x: 100, y: 101),
            CGPoint(x: 99, y: 100),
        ]

        var lastResult = CGPoint.zero
        for p in noisy {
            lastResult = filter.update(p)
        }

        // Smoothed result should be near 100,100 — not at the last noisy point
        XCTAssertEqual(lastResult.x, 100, accuracy: 10)
        XCTAssertEqual(lastResult.y, 100, accuracy: 10)
    }

    func testIndependentXYTracking() {
        var filter = KalmanFilter2D()

        _ = filter.update(CGPoint(x: 0, y: 0))
        // Move only in X
        let result = filter.update(CGPoint(x: 100, y: 0))

        // X should have moved toward 100, Y should stay near 0
        XCTAssertGreaterThan(result.x, 10)
        XCTAssertEqual(result.y, 0, accuracy: 1)
    }

    func testResetRestoresInitialState() {
        var filter = KalmanFilter2D()
        _ = filter.update(CGPoint(x: 500, y: 500))
        _ = filter.update(CGPoint(x: 500, y: 500))

        filter.reset()

        // After reset, next update should return the measurement directly (re-init)
        let point = CGPoint(x: 100, y: 200)
        let result = filter.update(point)
        XCTAssertEqual(result.x, point.x, accuracy: 0.001)
        XCTAssertEqual(result.y, point.y, accuracy: 0.001)
    }

    func testLargeJumpIsSmoothed() {
        var filter = KalmanFilter2D()

        _ = filter.update(CGPoint(x: 100, y: 100))
        // Sudden jump to (1000, 1000)
        let result = filter.update(CGPoint(x: 1000, y: 1000))

        // Filter should not jump all the way — smoothed result should be between
        XCTAssertGreaterThan(result.x, 100)
        XCTAssertLessThan(result.x, 1000)
        XCTAssertGreaterThan(result.y, 100)
        XCTAssertLessThan(result.y, 1000)
    }
}
