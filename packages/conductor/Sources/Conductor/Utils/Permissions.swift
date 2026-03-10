// Permissions.swift — #permissions-onboarding
// Convenience functions for permission checking used across the app.

import Foundation

/// Check if all required permissions for a specific feature are met.
enum PermissionRequirement {
    /// Basic operation: buffer + window detection + keyboard input.
    /// Requires: Accessibility only.
    case core

    /// Voice input via WhisperKit.
    /// Requires: Microphone.
    case voice

    /// Gesture input via Apple Vision.
    /// Requires: Camera.
    case gesture

    /// Gaze tracking via MediaPipe.
    /// Requires: Camera.
    case gaze

    /// Full operation: all features.
    /// Requires: Camera + Microphone + Accessibility.
    case full

    /// Check if the given status satisfies this requirement.
    func isSatisfied(by status: PermissionStatus) -> Bool {
        switch self {
        case .core:
            return status.accessibility == .granted
        case .voice:
            return status.microphone == .granted
        case .gesture:
            return status.camera == .granted
        case .gaze:
            return status.camera == .granted
        case .full:
            return status.allGranted
        }
    }
}
