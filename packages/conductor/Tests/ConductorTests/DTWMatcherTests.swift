// DTWMatcherTests.swift
// Tests for #dtw-matcher Dynamic Time Warping implementation.

import XCTest
@testable import Conductor

final class DTWMatcherTests: XCTestCase {

    // MARK: - Helpers

    private func makeFrame(timestamp: TimeInterval, x: Double, y: Double) -> HandPoseFrame {
        let point = CGPointCodable(x: x, y: y)
        return HandPoseFrame(
            timestamp: timestamp,
            thumbTip: point, indexTip: point, middleTip: point,
            ringTip: point, littleTip: point, wrist: point,
            indexMCP: point, middleMCP: point, ringMCP: point, littleMCP: point
        )
    }

    private func makeSequence(count: Int, baseX: Double = 0, baseY: Double = 0) -> [HandPoseFrame] {
        (0..<count).map { i in
            makeFrame(timestamp: Double(i) * 0.1, x: baseX + Double(i) * 0.01, y: baseY + Double(i) * 0.01)
        }
    }

    // MARK: - Identical Sequences

    func testIdenticalSequencesHaveZeroDistance() {
        let seq = makeSequence(count: 10)
        let distance = DTWMatcher.distance(seq, seq)
        XCTAssertEqual(distance, 0, accuracy: 0.001)
    }

    // MARK: - Similar Sequences

    func testSimilarSequencesHaveLowDistance() {
        let seq1 = makeSequence(count: 10, baseX: 0)
        let seq2 = makeSequence(count: 10, baseX: 0.01) // Small offset
        let distance = DTWMatcher.distance(seq1, seq2)
        XCTAssertLessThan(distance, 0.1)
    }

    // MARK: - Different Sequences

    func testDifferentSequencesHaveHighDistance() {
        let seq1 = makeSequence(count: 10, baseX: 0)
        let seq2 = makeSequence(count: 10, baseX: 1.0) // Large offset
        let distance = DTWMatcher.distance(seq1, seq2)
        XCTAssertGreaterThan(distance, 0.5)
    }

    // MARK: - Different Lengths

    func testDifferentLengthsAreHandled() {
        let seq1 = makeSequence(count: 10)
        let seq2 = makeSequence(count: 15) // Longer
        let distance = DTWMatcher.distance(seq1, seq2)
        XCTAssertGreaterThan(distance, 0) // Should not crash, produces valid result
        XCTAssertLessThan(distance, .infinity)
    }

    // MARK: - Empty Sequences

    func testEmptySequenceReturnsInfinity() {
        let empty: [HandPoseFrame] = []
        let seq = makeSequence(count: 5)
        let distance = DTWMatcher.distance(empty, seq)
        XCTAssertEqual(distance, .infinity)
    }

    // MARK: - Threshold-Based Matching

    func testThresholdAcceptsClose() {
        let seq = makeSequence(count: 10)
        let template = GestureTemplate(
            id: "test", name: "test", frames: seq,
            matchThreshold: 0.5,
            createdAt: .now, recordingCount: 5, boundAction: "send"
        )
        XCTAssertTrue(DTWMatcher.isMatch(seq, template: template))
    }

    func testThresholdRejectsFar() {
        let seq1 = makeSequence(count: 10, baseX: 0)
        let seq2 = makeSequence(count: 10, baseX: 5.0) // Very different
        let template = GestureTemplate(
            id: "test", name: "test", frames: seq1,
            matchThreshold: 0.01, // Very strict
            createdAt: .now, recordingCount: 5, boundAction: "send"
        )
        XCTAssertFalse(DTWMatcher.isMatch(seq2, template: template))
    }

    // MARK: - Frame Distance

    func testFrameDistanceSameFrameIsZero() {
        let frame = makeFrame(timestamp: 0, x: 0.5, y: 0.5)
        let distance = DTWMatcher.frameDistance(frame, frame)
        XCTAssertEqual(distance, 0, accuracy: 0.001)
    }
}
