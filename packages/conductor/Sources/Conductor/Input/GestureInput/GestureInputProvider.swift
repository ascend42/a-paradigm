// GestureInputProvider.swift — ~platform-abstracted
// Protocol for hand gesture recognition.
// macOS: Apple Vision framework (VNDetectHumanHandPoseRequest, Neural Engine) — Sprint 3
// Windows: MediaPipe Hands (future)

import Foundation

/// Platform-abstracted gesture input provider.
/// Implementations detect hand poses from camera and classify them into actions.
@MainActor
protocol GestureInputProvider: InputProvider {
    /// Async stream of classified gesture actions.
    var gestureStream: AsyncStream<GestureAction> { get }

    /// Current raw hand state (for HUD visualization).
    var currentHandState: HandState { get }

    /// Frames per second for hand pose detection.
    var detectionFPS: Int { get set }
}
