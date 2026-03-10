// PermissionsManager.swift — #permissions-onboarding
// macOS permission checks and request flows for Camera, Microphone, and Accessibility.

import AVFoundation
import AppKit

/// Aggregate permission status.
struct PermissionStatus {
    var camera: PermissionState
    var microphone: PermissionState
    var accessibility: PermissionState

    var allGranted: Bool {
        camera == .granted && microphone == .granted && accessibility == .granted
    }

    /// Permissions required for basic operation (buffer + window detection).
    var coreGranted: Bool {
        accessibility == .granted
    }
}

enum PermissionState: String {
    case granted
    case denied
    case notDetermined
    case restricted
}

/// Manages macOS permission requests for Camera, Microphone, and Accessibility.
final class PermissionsManager {

    // MARK: - Check All

    func checkAll() -> PermissionStatus {
        PermissionStatus(
            camera: checkCamera(),
            microphone: checkMicrophone(),
            accessibility: checkAccessibility()
        )
    }

    // MARK: - Camera (^camera-permission)

    func checkCamera() -> PermissionState {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .granted
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }

    func requestCamera() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .video)
    }

    // MARK: - Microphone (^microphone-permission)

    func checkMicrophone() -> PermissionState {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .granted
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }

    func requestMicrophone() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .audio)
    }

    // MARK: - Accessibility (^accessibility-permission)

    func checkAccessibility() -> PermissionState {
        let trusted = AXIsProcessTrusted()
        return trusted ? .granted : .denied
    }

    /// Opens System Settings to the Accessibility privacy pane.
    func requestAccessibility() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        NSWorkspace.shared.open(url)
    }
}
