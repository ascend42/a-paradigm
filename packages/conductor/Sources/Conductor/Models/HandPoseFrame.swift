// HandPoseFrame.swift — #conductor-models
// Lightweight snapshot of hand joint positions for gesture recording/matching.
// Extracted from VNHumanHandPoseObservation for serialization.

import Foundation

/// A single frame of hand pose data for recording and template matching.
struct HandPoseFrame: Codable, Equatable {
    /// Timestamp relative to recording start (seconds).
    let timestamp: TimeInterval

    /// Normalized joint positions (10 key points).
    let thumbTip: CGPointCodable
    let indexTip: CGPointCodable
    let middleTip: CGPointCodable
    let ringTip: CGPointCodable
    let littleTip: CGPointCodable
    let wrist: CGPointCodable
    let indexMCP: CGPointCodable
    let middleMCP: CGPointCodable
    let ringMCP: CGPointCodable
    let littleMCP: CGPointCodable

    /// All joint positions as an array (for DTW distance computation).
    var jointPositions: [CGPointCodable] {
        [thumbTip, indexTip, middleTip, ringTip, littleTip,
         wrist, indexMCP, middleMCP, ringMCP, littleMCP]
    }
}

/// Codable wrapper for CGPoint.
struct CGPointCodable: Codable, Equatable {
    let x: Double
    let y: Double

    init(_ point: CGPoint) {
        self.x = Double(point.x)
        self.y = Double(point.y)
    }

    init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    var cgPoint: CGPoint {
        CGPoint(x: x, y: y)
    }

    /// Euclidean distance to another point.
    func distance(to other: CGPointCodable) -> Double {
        let dx = x - other.x
        let dy = y - other.y
        return (dx * dx + dy * dy).squareRoot()
    }
}
