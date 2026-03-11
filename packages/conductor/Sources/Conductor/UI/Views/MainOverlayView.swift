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

    @StateObject private var detector = ClaudeCodeDetector()
    @StateObject private var sessionWatcher = SessionFileWatcher()
    @ObservedObject private var gazeRouter = GazeRouter.shared
    @ObservedObject var orchestrator: InputOrchestrator
    @ObservedObject var workspaceManager: WorkspaceManager

    @State private var showAddInstance = false

    init(showOnboarding: Bool, permissionStatus: PermissionStatus, orchestrator: InputOrchestrator, workspaceManager: WorkspaceManager) {
        self._showOnboarding = State(initialValue: showOnboarding)
        self.permissionStatus = permissionStatus
        self.orchestrator = orchestrator
        self.workspaceManager = workspaceManager
    }

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
            Text("v0.5.2")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer()
            inputToggles
            statusIndicator
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var inputToggles: some View {
        HStack(spacing: 6) {
            // Video toggle (gaze + gesture camera)
            Button(action: {
                Task { await orchestrator.toggleVideo() }
            }) {
                Image(systemName: orchestrator.videoActive ? "video.fill" : "video.slash.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(orchestrator.videoActive ? .green : .secondary)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .help(orchestrator.videoActive ? "Disable camera (Cmd+Shift+V)" : "Enable camera (Cmd+Shift+V)")

            // Voice toggle
            Button(action: {
                Task { await orchestrator.toggleVoice() }
            }) {
                Image(systemName: orchestrator.voiceActive ? "mic.fill" : "mic.slash.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(orchestrator.voiceActive ? .green : .secondary)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .help(orchestrator.voiceActive ? "Mute voice (Cmd+Shift+M)" : "Unmute voice (Cmd+Shift+M)")

            Divider()
                .frame(height: 16)
        }
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

    /// External instances not managed by the workspace (AX-detected + file-registered minus managed).
    private var externalInstances: [ClaudeCodeInstance] {
        let managedPIDs = Set(workspaceManager.managedInstances.compactMap(\.processID))
        return allInstances.filter { !managedPIDs.contains($0.processID) }
    }

    private var mainContent: some View {
        VStack(spacing: 12) {
            // Gaze calibration prompt
            if gazeEnabled && !gazeCalibrated {
                calibrationBanner
            }

            // Live input status monitor
            InputStatusView(orchestrator: orchestrator)

            // Voice control HUD (shows when eyebrow control is active)
            if orchestrator.eyebrowEnabled {
                VoiceControlHUD(coordinator: orchestrator.voiceCoordinator)
            }

            Divider()

            // Buffer area
            BufferView(
                buffer: orchestrator.buffer,
                gazeRouter: gazeRouter,
                orchestrator: orchestrator,
                gazeZoneRouter: orchestrator.gazeZoneRouter,
                onSend: dispatchBuffer
            )

            Divider()

            // Workspace view (managed instances + external)
            WorkspaceView(
                workspaceManager: workspaceManager,
                gazeRouter: gazeRouter,
                externalInstances: externalInstances,
                onAddInstance: { showAddInstance = true }
            )

            Spacer(minLength: 0)
        }
        .padding(12)
        .sheet(isPresented: $showAddInstance) {
            AddInstanceSheet(
                workspaceManager: workspaceManager,
                isPresented: $showAddInstance
            )
        }
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
        Task {
            await orchestrator.executeAction(.send)
        }
    }
}
