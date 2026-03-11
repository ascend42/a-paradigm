// EyebrowDetector.swift — #eyebrow-detector
// Consumes raw EyebrowFrame stream, applies 1D Kalman smoothing,
// and emits discrete EyebrowEvent values via threshold + hysteresis.

import Foundation

/// Processes raw eyebrow distance frames into discrete raise/lower events.
@MainActor
final class EyebrowDetector: ObservableObject {

    // MARK: - Published State

    @Published private(set) var lastEvent: EyebrowEvent?
    @Published private(set) var smoothedLeft: Double = 0
    @Published private(set) var smoothedRight: Double = 0

    // MARK: - Configuration

    /// Distance above which an eyebrow is considered "raised".
    var raiseThreshold: Double = 0.035

    /// Distance below which a raised eyebrow is considered "lowered".
    /// Must be less than raiseThreshold for hysteresis.
    var lowerThreshold: Double = 0.025

    // MARK: - Private

    private var leftFilter = KalmanFilter1D()
    private var rightFilter = KalmanFilter1D()
    private var leftRaised = false
    private var rightRaised = false
    private var eventContinuation: AsyncStream<EyebrowEvent>.Continuation?

    // MARK: - Stream

    /// Async stream of discrete eyebrow events.
    var eventStream: AsyncStream<EyebrowEvent> {
        AsyncStream { [weak self] continuation in
            Task { @MainActor in
                self?.eventContinuation = continuation
            }
        }
    }

    // MARK: - Processing

    /// Process a raw eyebrow frame and emit events if thresholds are crossed.
    func process(_ frame: EyebrowFrame) {
        smoothedLeft = leftFilter.update(frame.leftDistance)
        smoothedRight = rightFilter.update(frame.rightDistance)

        // Left eyebrow
        if !leftRaised && smoothedLeft > raiseThreshold {
            leftRaised = true
            emit(.leftRaise)
        } else if leftRaised && smoothedLeft < lowerThreshold {
            leftRaised = false
            emit(.leftLower)
        }

        // Right eyebrow
        if !rightRaised && smoothedRight > raiseThreshold {
            rightRaised = true
            emit(.rightRaise)
        } else if rightRaised && smoothedRight < lowerThreshold {
            rightRaised = false
            emit(.rightLower)
        }
    }

    /// Reset filter state and thresholds.
    func reset() {
        leftFilter.reset()
        rightFilter.reset()
        leftRaised = false
        rightRaised = false
        smoothedLeft = 0
        smoothedRight = 0
    }

    /// Update thresholds from calibration data.
    func setThresholds(raise: Double, lower: Double) {
        raiseThreshold = raise
        lowerThreshold = lower
    }

    private func emit(_ event: EyebrowEvent) {
        lastEvent = event
        eventContinuation?.yield(event)
        ConductorLog.signal("eyebrow-\(event)")
            .info("Eyebrow event: \(event)")
    }
}

// MARK: - 1D Kalman Filter

/// Simplified 1D Kalman filter for scalar smoothing (eyebrow distances).
struct KalmanFilter1D {
    private var x: Double = 0
    private var v: Double = 0
    private var px: Double = 1000
    private var pv: Double = 1000
    var processNoise: Double = 0.05
    var measurementNoise: Double = 0.5
    private var initialized = false

    mutating func update(_ measurement: Double) -> Double {
        if !initialized {
            x = measurement
            v = 0
            initialized = true
            return measurement
        }

        // Predict
        let predictedX = x + v
        let predictedPx = px + pv + processNoise

        // Update
        let k = predictedPx / (predictedPx + measurementNoise)
        let newX = predictedX + k * (measurement - predictedX)
        v = newX - x
        x = newX
        px = (1 - k) * predictedPx

        return x
    }

    mutating func reset() {
        initialized = false
        px = 1000
        pv = 1000
    }
}
