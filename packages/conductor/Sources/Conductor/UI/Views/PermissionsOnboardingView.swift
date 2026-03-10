// PermissionsOnboardingView.swift — #permissions-onboarding
// Step-by-step permission request flow for Camera, Microphone, and Accessibility.

import SwiftUI

struct PermissionsOnboardingView: View {
    let status: PermissionStatus
    let onDismiss: () -> Void

    @State private var permissionsManager = PermissionsManager()
    @State private var currentStatus: PermissionStatus

    init(status: PermissionStatus, onDismiss: @escaping () -> Void) {
        self.status = status
        self.onDismiss = onDismiss
        self._currentStatus = State(initialValue: status)
    }

    var body: some View {
        VStack(spacing: 16) {
            // Title
            VStack(spacing: 4) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 32))
                    .foregroundStyle(.cyan)
                Text("Permissions")
                    .font(.title3.bold())
                Text("Conductor needs access to work with your camera, microphone, and windows.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 8)

            // Permission rows
            VStack(spacing: 12) {
                permissionRow(
                    icon: "camera",
                    title: "Camera",
                    detail: "Hand gesture recognition & gaze tracking",
                    state: currentStatus.camera,
                    action: requestCamera
                )

                permissionRow(
                    icon: "mic",
                    title: "Microphone",
                    detail: "Voice-to-text transcription",
                    state: currentStatus.microphone,
                    action: requestMicrophone
                )

                permissionRow(
                    icon: "accessibility",
                    title: "Accessibility",
                    detail: "Window detection & text dispatch (required)",
                    state: currentStatus.accessibility,
                    action: requestAccessibility
                )
            }

            Spacer()

            // Continue button
            if currentStatus.coreGranted {
                Button(action: onDismiss) {
                    Text(currentStatus.allGranted ? "Get Started" : "Continue (basic mode)")
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.large)
                .buttonStyle(.borderedProminent)
            } else {
                Text("Accessibility permission is required for Conductor to function.")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(16)
    }

    // MARK: - Permission Row

    private func permissionRow(
        icon: String,
        title: String,
        detail: String,
        state: PermissionState,
        action: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.secondary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.bold())
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            stateView(for: state, action: action)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
    }

    @ViewBuilder
    private func stateView(for state: PermissionState, action: @escaping () -> Void) -> some View {
        switch state {
        case .granted:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .denied:
            Button("Open Settings") {
                action()
            }
            .controlSize(.small)
            .buttonStyle(.bordered)
        case .notDetermined:
            Button("Grant") {
                action()
            }
            .controlSize(.small)
            .buttonStyle(.borderedProminent)
        case .restricted:
            Image(systemName: "lock.fill")
                .foregroundStyle(.red)
        }
    }

    // MARK: - Actions

    private func requestCamera() {
        Task {
            _ = await permissionsManager.requestCamera()
            currentStatus = permissionsManager.checkAll()
        }
    }

    private func requestMicrophone() {
        Task {
            _ = await permissionsManager.requestMicrophone()
            currentStatus = permissionsManager.checkAll()
        }
    }

    private func requestAccessibility() {
        permissionsManager.requestAccessibility()
        // Accessibility requires user to manually toggle in System Settings,
        // then restart the app. Poll after a delay.
        Task {
            try? await Task.sleep(for: .seconds(2))
            currentStatus = permissionsManager.checkAll()
        }
    }
}
