// GazeTrackingProvider.swift — ~platform-abstracted
// Protocol for gaze (eye) tracking.
// Both platforms: MediaPipe FaceMesh — Sprint 4

import Foundation

/// Platform-abstracted gaze tracking provider.
/// Implementations estimate where the user is looking on screen.
@MainActor
protocol GazeTrackingProvider: InputProvider {
    /// Async stream of estimated screen-space gaze points.
    var gazePointStream: AsyncStream<CGPoint> { get }

    /// Run the calibration flow (typically 5-point).
    func calibrate() async throws

    /// Whether calibration has been completed.
    var isCalibrated: Bool { get }
}
