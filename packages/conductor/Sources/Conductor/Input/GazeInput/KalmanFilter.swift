// KalmanFilter.swift — #kalman-filter
// 2D Kalman filter for smoothing gaze point coordinates.
// Reduces jitter from webcam-based iris tracking.

import Foundation

/// Simple 2D Kalman filter for screen coordinate smoothing.
/// State: [x, y, vx, vy] — position + velocity.
struct KalmanFilter2D {
    // State estimate
    private var x: Double = 0  // x position
    private var y: Double = 0  // y position
    private var vx: Double = 0 // x velocity
    private var vy: Double = 0 // y velocity

    // Covariance (simplified: diagonal only)
    private var px: Double = 1000
    private var py: Double = 1000
    private var pvx: Double = 1000
    private var pvy: Double = 1000

    /// Process noise — higher = more responsive, lower = smoother.
    var processNoise: Double = 0.1

    /// Measurement noise — higher = smoother, lower = more responsive.
    var measurementNoise: Double = 1.0

    /// Whether this filter has been initialized with a measurement.
    private var initialized = false

    /// Update the filter with a new measurement and return the smoothed point.
    mutating func update(_ measurement: CGPoint) -> CGPoint {
        let mx = Double(measurement.x)
        let my = Double(measurement.y)

        if !initialized {
            x = mx
            y = my
            vx = 0
            vy = 0
            initialized = true
            return measurement
        }

        // Predict step
        let predictedX = x + vx
        let predictedY = y + vy
        let predictedPx = px + pvx + processNoise
        let predictedPy = py + pvy + processNoise

        // Update step (Kalman gain)
        let kx = predictedPx / (predictedPx + measurementNoise)
        let ky = predictedPy / (predictedPy + measurementNoise)

        // Update position
        let newX = predictedX + kx * (mx - predictedX)
        let newY = predictedY + ky * (my - predictedY)

        // Update velocity
        vx = newX - x
        vy = newY - y

        // Update state
        x = newX
        y = newY

        // Update covariance
        px = (1 - kx) * predictedPx
        py = (1 - ky) * predictedPy

        return CGPoint(x: x, y: y)
    }

    /// Reset the filter state.
    mutating func reset() {
        initialized = false
        px = 1000
        py = 1000
        pvx = 1000
        pvy = 1000
    }
}
