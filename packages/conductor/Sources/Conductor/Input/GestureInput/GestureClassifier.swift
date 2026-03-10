// GestureClassifier.swift — #gesture-classifier
// Joint positions → HandState mapping using Apple Vision hand pose observations.

import Vision
import Foundation

/// Classifies VNHumanHandPoseObservation into discrete HandState values.
struct GestureClassifier {
    /// Previous wrist position for velocity-based swipe detection.
    private var previousWristX: CGFloat?
    private var previousTimestamp: Date?

    /// Velocity threshold for swipe detection (points per second).
    private let swipeThreshold: CGFloat = 0.3
    private let fastSwipeThreshold: CGFloat = 0.6

    /// Distance threshold for pinch detection (normalized).
    private let pinchThreshold: CGFloat = 0.05

    mutating func classify(_ observation: VNHumanHandPoseObservation) -> HandState {
        guard let points = try? extractKeyPoints(from: observation) else {
            return .none
        }

        // Check two-finger tap (index + middle tips close together and moving down)
        if isTwoFingerTap(points) {
            return .twoFingerTap
        }

        // Check pinch (thumb tip + index tip close)
        if isPinch(points) {
            return .pinch
        }

        // Check fist (all fingers curled)
        if isFist(points) {
            return .fist
        }

        // Check open palm (all fingers extended)
        if isOpenPalm(points) {
            return .open
        }

        // Check swipe (wrist horizontal movement)
        if let swipe = detectSwipe(wristX: points.wrist.x) {
            return swipe
        }

        return .none
    }

    // MARK: - Gesture Detection

    private func extractKeyPoints(from observation: VNHumanHandPoseObservation) throws -> HandPoints {
        let thumbTip = try observation.recognizedPoint(.thumbTip)
        let indexTip = try observation.recognizedPoint(.indexTip)
        let middleTip = try observation.recognizedPoint(.middleTip)
        let ringTip = try observation.recognizedPoint(.ringTip)
        let littleTip = try observation.recognizedPoint(.littleTip)
        let wrist = try observation.recognizedPoint(.wrist)
        let indexMCP = try observation.recognizedPoint(.indexMCP)
        let middleMCP = try observation.recognizedPoint(.middleMCP)
        let ringMCP = try observation.recognizedPoint(.ringMCP)
        let littleMCP = try observation.recognizedPoint(.littleMCP)

        return HandPoints(
            thumbTip: thumbTip.location,
            indexTip: indexTip.location,
            middleTip: middleTip.location,
            ringTip: ringTip.location,
            littleTip: littleTip.location,
            wrist: wrist.location,
            indexMCP: indexMCP.location,
            middleMCP: middleMCP.location,
            ringMCP: ringMCP.location,
            littleMCP: littleMCP.location
        )
    }

    private func isPinch(_ p: HandPoints) -> Bool {
        distance(p.thumbTip, p.indexTip) < pinchThreshold
    }

    private func isFist(_ p: HandPoints) -> Bool {
        // All fingertips should be below (closer to wrist than) their MCPs
        let indexCurled = p.indexTip.y < p.indexMCP.y
        let middleCurled = p.middleTip.y < p.middleMCP.y
        let ringCurled = p.ringTip.y < p.ringMCP.y
        let littleCurled = p.littleTip.y < p.littleMCP.y
        return indexCurled && middleCurled && ringCurled && littleCurled
    }

    private func isOpenPalm(_ p: HandPoints) -> Bool {
        // All fingertips should be above (further from wrist than) their MCPs
        let indexExtended = p.indexTip.y > p.indexMCP.y
        let middleExtended = p.middleTip.y > p.middleMCP.y
        let ringExtended = p.ringTip.y > p.ringMCP.y
        let littleExtended = p.littleTip.y > p.littleMCP.y
        return indexExtended && middleExtended && ringExtended && littleExtended
    }

    private func isTwoFingerTap(_ p: HandPoints) -> Bool {
        // Index and middle fingertips close together
        let tipsClose = distance(p.indexTip, p.middleTip) < 0.08
        // Both extended
        let indexExtended = p.indexTip.y > p.indexMCP.y
        let middleExtended = p.middleTip.y > p.middleMCP.y
        // Ring and little curled
        let ringCurled = p.ringTip.y < p.ringMCP.y
        let littleCurled = p.littleTip.y < p.littleMCP.y
        return tipsClose && indexExtended && middleExtended && ringCurled && littleCurled
    }

    private mutating func detectSwipe(wristX: CGFloat) -> HandState? {
        defer {
            previousWristX = wristX
            previousTimestamp = Date()
        }

        guard let prevX = previousWristX, let prevTime = previousTimestamp else {
            return nil
        }

        let dt = Date().timeIntervalSince(prevTime)
        guard dt > 0 else { return nil }

        let velocity = (wristX - prevX) / dt
        let absVelocity = abs(velocity)

        if absVelocity > fastSwipeThreshold {
            return velocity > 0 ? .swipeRight(velocity: absVelocity) : .swipeLeft(velocity: absVelocity)
        } else if absVelocity > swipeThreshold {
            return velocity > 0 ? .swipeRight(velocity: absVelocity) : .swipeLeft(velocity: absVelocity)
        }

        return nil
    }

    // MARK: - Helpers

    private func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
        hypot(a.x - b.x, a.y - b.y)
    }
}

/// Key hand joint positions for gesture classification.
private struct HandPoints {
    let thumbTip: CGPoint
    let indexTip: CGPoint
    let middleTip: CGPoint
    let ringTip: CGPoint
    let littleTip: CGPoint
    let wrist: CGPoint
    let indexMCP: CGPoint
    let middleMCP: CGPoint
    let ringMCP: CGPoint
    let littleMCP: CGPoint
}
