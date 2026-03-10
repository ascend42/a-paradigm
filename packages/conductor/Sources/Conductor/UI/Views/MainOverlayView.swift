// MainOverlayView.swift — #conductor-app
// Root SwiftUI view for the Conductor overlay panel.
// Composes: onboarding, buffer view, instance list, and (later) gesture HUD.

import SwiftUI

struct MainOverlayView: View {
    @State var showOnboarding: Bool
    let permissionStatus: PermissionStatus

    @StateObject private var buffer = BufferEngine()
    @StateObject private var detector = ClaudeCodeDetector()
    @StateObject private var gazeRouter = GazeRouter()

    private let dispatchTarget = AXDispatchTarget()

    var body: some View {
        VStack(spacing: 0) {
            // Header
            headerBar

            Divider()

            if showOnboarding {
                PermissionsOnboardingView(
                    status: permissionStatus,
                    onDismiss: {
                        showOnboarding = false
                        startDetection()
                    }
                )
            } else {
                // Main content area
                mainContent
            }
        }
        .frame(minWidth: 280, idealWidth: 320, maxWidth: 400)
        .frame(minHeight: 300, idealHeight: 550)
        .background(.ultraThinMaterial)
        .onAppear {
            if !showOnboarding {
                startDetection()
            }
        }
        .onDisappear {
            detector.stopPolling()
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            Image(systemName: "waveform.badge.mic")
                .foregroundStyle(.cyan)
            Text("Conductor")
                .font(.headline)
            Spacer()
            statusIndicator
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var statusIndicator: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(permissionStatus.allGranted ? .green : .orange)
                .frame(width: 8, height: 8)
            Text(statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var statusText: String {
        if !permissionStatus.coreGranted {
            return "Setup needed"
        }
        if detector.instances.isEmpty {
            return "No targets"
        }
        if gazeRouter.currentTarget != nil {
            return "Ready"
        }
        return "\(detector.instances.count) found"
    }

    // MARK: - Main Content

    private var mainContent: some View {
        VStack(spacing: 12) {
            // Buffer area
            BufferView(
                buffer: buffer,
                gazeRouter: gazeRouter,
                onSend: dispatchBuffer
            )

            Divider()

            // Instance list
            InstanceListView(
                detector: detector,
                gazeRouter: gazeRouter
            )

            Spacer(minLength: 0)
        }
        .padding(12)
    }

    // MARK: - Actions

    private func startDetection() {
        detector.startPolling(interval: 2.0)
    }

    private func dispatchBuffer() {
        guard let target = gazeRouter.currentTarget else {
            ConductorLog.component("conductor-app").info("No target for dispatch")
            return
        }

        let text = buffer.flush()
        guard !text.isEmpty else { return }

        Task {
            do {
                try await dispatchTarget.sendText(text, to: target, submit: true)
                ConductorLog.signal("buffer-dispatched")
                    .info("Dispatched \(text.count) chars to \(target.title)")
            } catch {
                ConductorLog.component("conductor-app")
                    .error("Dispatch failed: \(error.localizedDescription)")
                // Put text back in buffer on failure
                buffer.append(text)
            }
        }
    }
}
