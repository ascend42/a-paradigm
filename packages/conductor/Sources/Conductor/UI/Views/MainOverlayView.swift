// MainOverlayView.swift — #conductor-app
// Root SwiftUI view for the Conductor overlay panel.
// Composes: onboarding, buffer view, instance list, and (later) gesture HUD.

import SwiftUI

struct MainOverlayView: View {
    @State var showOnboarding: Bool
    let permissionStatus: PermissionStatus

    @AppStorage("setupComplete") private var setupComplete: Bool = false
    @AppStorage("gazeEnabled") private var gazeEnabled: Bool = false
    @AppStorage("gazeCalibrated") private var gazeCalibrated: Bool = false

    @StateObject private var buffer = BufferEngine()
    @StateObject private var detector = ClaudeCodeDetector()
    @StateObject private var sessionWatcher = SessionFileWatcher()
    @ObservedObject private var gazeRouter = GazeRouter.shared

    private let dispatchTarget = AXDispatchTarget()

    /// Merged instances from AX detection + file-registered sessions.
    private var allInstances: [ClaudeCodeInstance] {
        var merged = detector.instances

        // Add file-registered instances that aren't already detected via AX
        for regInstance in sessionWatcher.registeredInstances {
            // Deduplicate by project directory match or PID match
            let isDuplicate = merged.contains { existing in
                existing.processID == regInstance.processID ||
                (existing.projectDirectory != nil &&
                 existing.projectDirectory == regInstance.projectDirectory)
            }
            if !isDuplicate {
                merged.append(regInstance)
            }
        }

        return merged
    }

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
                        if setupComplete {
                            startDetection()
                        }
                    }
                )
            } else if !setupComplete {
                SetupWizardView(onComplete: {
                    setupComplete = true
                    startDetection()
                })
            } else {
                // Main content area
                mainContent
            }
        }
        .frame(minWidth: 280, idealWidth: 320, maxWidth: 400)
        .frame(minHeight: 300, idealHeight: 550)
        .background(.ultraThinMaterial)
        .onAppear {
            if !showOnboarding && setupComplete {
                startDetection()
            }
        }
        .onDisappear {
            detector.stopPolling()
            sessionWatcher.stopWatching()
        }
        .onReceive(NotificationCenter.default.publisher(for: .conductorRunSetup)) { _ in
            detector.stopPolling()
            sessionWatcher.stopWatching()
            setupComplete = false
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            Image(systemName: "waveform.badge.mic")
                .foregroundStyle(.cyan)
            Text("Conductor")
                .font(.headline)
            Text("v0.2.0")
                .font(.caption2)
                .foregroundStyle(.secondary)
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
        if allInstances.isEmpty {
            return "No targets"
        }
        if gazeRouter.currentTarget != nil {
            return "Ready"
        }
        return "\(allInstances.count) found"
    }

    // MARK: - Main Content

    private var mainContent: some View {
        VStack(spacing: 12) {
            // Gaze calibration prompt
            if gazeEnabled && !gazeCalibrated {
                calibrationBanner
            }

            // Buffer area
            BufferView(
                buffer: buffer,
                gazeRouter: gazeRouter,
                onSend: dispatchBuffer
            )

            Divider()

            // Instance list (merged: AX-detected + file-registered)
            InstanceListView(
                instances: allInstances,
                gazeRouter: gazeRouter
            )

            Spacer(minLength: 0)
        }
        .padding(12)
    }

    private var calibrationBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "eye.trianglebadge.exclamationmark")
                .foregroundStyle(.orange)
            Text("Gaze not calibrated")
                .font(.caption)
            Spacer()
            Button("Calibrate") {
                NotificationCenter.default.post(name: .conductorRecalibrate, object: nil)
            }
            .controlSize(.small)
            .buttonStyle(.borderedProminent)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.1)))
    }

    // MARK: - Actions

    private func startDetection() {
        detector.startPolling(interval: 2.0)
        sessionWatcher.startWatching()
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
