// EyebrowCalibration.swift — #eyebrow-calibration
// Optional calibration flow that learns the user's eyebrow raise range.
// Stores personalized thresholds in UserDefaults.

import Foundation

/// Calibrates eyebrow detection thresholds based on user's natural range.
@MainActor
final class EyebrowCalibration: ObservableObject {

    // MARK: - State

    enum CalibrationStep: Int, CaseIterable {
        case restLeft      // Record resting left eyebrow
        case raiseLeft     // Record raised left eyebrow
        case restRight     // Record resting right eyebrow
        case raiseRight    // Record raised right eyebrow
    }

    @Published private(set) var currentStep: CalibrationStep = .restLeft
    @Published private(set) var isComplete = false
    @Published private(set) var currentLeftDistance: Double = 0
    @Published private(set) var currentRightDistance: Double = 0

    // MARK: - Collected Data

    private var restLeftSamples: [Double] = []
    private var raisedLeftSamples: [Double] = []
    private var restRightSamples: [Double] = []
    private var raisedRightSamples: [Double] = []

    private var sampleCount = 0
    private let requiredSamples = 30  // ~1 second at 30fps

    // MARK: - Results

    /// Computed raise threshold (midpoint between rest and raised).
    var raiseThreshold: Double {
        let restLeft = average(restLeftSamples)
        let raisedLeft = average(raisedLeftSamples)
        let restRight = average(restRightSamples)
        let raisedRight = average(raisedRightSamples)

        let leftMid = (restLeft + raisedLeft) / 2
        let rightMid = (restRight + raisedRight) / 2
        return (leftMid + rightMid) / 2
    }

    /// Computed lower threshold (slightly above rest position).
    var lowerThreshold: Double {
        let restLeft = average(restLeftSamples)
        let restRight = average(restRightSamples)
        let avgRest = (restLeft + restRight) / 2
        return avgRest + (raiseThreshold - avgRest) * 0.3
    }

    // MARK: - Processing

    /// Feed a frame during calibration. Returns true when the step is complete.
    func processSample(_ frame: EyebrowFrame) -> Bool {
        currentLeftDistance = frame.leftDistance
        currentRightDistance = frame.rightDistance

        switch currentStep {
        case .restLeft:
            restLeftSamples.append(frame.leftDistance)
        case .raiseLeft:
            raisedLeftSamples.append(frame.leftDistance)
        case .restRight:
            restRightSamples.append(frame.rightDistance)
        case .raiseRight:
            raisedRightSamples.append(frame.rightDistance)
        }

        sampleCount += 1

        if sampleCount >= requiredSamples {
            return true
        }
        return false
    }

    /// Advance to the next calibration step.
    func advanceStep() {
        sampleCount = 0

        switch currentStep {
        case .restLeft:
            currentStep = .raiseLeft
        case .raiseLeft:
            currentStep = .restRight
        case .restRight:
            currentStep = .raiseRight
        case .raiseRight:
            isComplete = true
            saveThresholds()
        }
    }

    /// Reset calibration.
    func reset() {
        currentStep = .restLeft
        isComplete = false
        sampleCount = 0
        restLeftSamples.removeAll()
        raisedLeftSamples.removeAll()
        restRightSamples.removeAll()
        raisedRightSamples.removeAll()
    }

    // MARK: - Persistence

    /// Save computed thresholds to UserDefaults.
    func saveThresholds() {
        let raise = raiseThreshold
        let lower = lowerThreshold
        UserDefaults.standard.set(raise, forKey: "eyebrowRaiseThreshold")
        UserDefaults.standard.set(lower, forKey: "eyebrowLowerThreshold")
        UserDefaults.standard.set(raise, forKey: "eyebrowSensitivity")

        ConductorLog.component("eyebrow-calibration")
            .info("Saved thresholds — raise: \(String(format: "%.4f", raise)), lower: \(String(format: "%.4f", lower))")
    }

    /// Load saved thresholds, returning nil if not calibrated.
    static func loadThresholds() -> (raise: Double, lower: Double)? {
        let raise = UserDefaults.standard.double(forKey: "eyebrowRaiseThreshold")
        let lower = UserDefaults.standard.double(forKey: "eyebrowLowerThreshold")
        guard raise > 0 && lower > 0 else { return nil }
        return (raise, lower)
    }

    // MARK: - Helpers

    private func average(_ samples: [Double]) -> Double {
        guard !samples.isEmpty else { return 0 }
        return samples.reduce(0, +) / Double(samples.count)
    }
}
