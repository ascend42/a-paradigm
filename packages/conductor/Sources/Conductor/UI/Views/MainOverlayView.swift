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
    @EnvironmentObject var env: ConductorEnvironment

    @State private var showAddInstance = false
    @State private var showHelp = false

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
            Text("v\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0")")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer()
            inputToggles

            Button(action: { showHelp = true }) {
                Image(systemName: "questionmark.circle")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Open Conductor Guide")
            .help("Conductor Guide")
            .sheet(isPresented: $showHelp) {
                HelpView(isPresented: $showHelp)
            }

            statusIndicator
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var inputToggles: some View {
        HStack(spacing: 6) {
            // Video toggle (gaze + gesture camera)
            Button(action: {
                Task { await env.orchestrator.toggleVideo() }
            }) {
                Image(systemName: env.orchestrator.videoActive ? "video.fill" : "video.slash.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(env.orchestrator.videoActive ? .green : .secondary)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(env.orchestrator.videoActive ? "Disable camera" : "Enable camera")
            .help(env.orchestrator.videoActive ? "Disable camera (Cmd+Shift+V)" : "Enable camera (Cmd+Shift+V)")

            // Voice toggle
            Button(action: {
                Task { await env.orchestrator.toggleVoice() }
            }) {
                Image(systemName: env.orchestrator.voiceActive ? "mic.fill" : "mic.slash.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(env.orchestrator.voiceActive ? .green : .secondary)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(env.orchestrator.voiceActive ? "Mute voice" : "Unmute voice")
            .help(env.orchestrator.voiceActive ? "Mute voice (Cmd+Shift+M)" : "Unmute voice (Cmd+Shift+M)")

            Divider()
                .frame(height: 16)
        }
    }

    private var statusIndicator: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(permissionStatus.allGranted ? .green : .orange)
                .frame(width: 8, height: 8)
                .accessibilityLabel(permissionStatus.allGranted ? "All permissions granted" : "Permissions incomplete")
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
        let managedPIDs = Set(env.workspaceManager.managedInstances.compactMap(\.processID))
        return allInstances.filter { !managedPIDs.contains($0.processID) }
    }

    private var mainContent: some View {
        VStack(spacing: 12) {
            calibrationSection
            inputSection
            Divider()
            bufferSection
            Divider()
            sessionSection
            Divider()
            workspaceSection
            symphonyNotificationsSection
            teamThreadSection
            taskSection
            agentNetworkSection
            agentHealthSection
            sentinelSection
            Spacer(minLength: 0)
        }
        .padding(12)
        .sheet(isPresented: $showAddInstance) {
            AddInstanceSheet(
                workspaceManager: env.workspaceManager,
                isPresented: $showAddInstance
            )
        }
    }

    // MARK: - Content Sections

    @ViewBuilder
    private var calibrationSection: some View {
        if gazeEnabled && !gazeCalibrated {
            calibrationBanner
        }
    }

    @ViewBuilder
    private var inputSection: some View {
        InputStatusView(orchestrator: env.orchestrator)
        if env.orchestrator.eyebrowEnabled {
            VoiceControlHUD(coordinator: env.orchestrator.voiceCoordinator)
        }
    }

    private var bufferSection: some View {
        BufferView(
            buffer: env.orchestrator.buffer,
            gazeRouter: gazeRouter,
            orchestrator: env.orchestrator,
            gazeZoneRouter: env.orchestrator.gazeZoneRouter,
            onSend: dispatchBuffer
        )
    }

    private var sessionSection: some View {
        SessionManagerView(
            projectStore: env.projectStore,
            agentManager: env.agentProcessManager,
            agentGroupStore: env.agentGroupStore,
            onLaunchInTerminal: { projectPath in
                Task {
                    try? await env.workspaceManager.launchInstance(
                        projectDir: projectPath,
                        label: CheckpointReader.projectName(for: projectPath)
                    )
                }
            }
        )
    }

    private var workspaceSection: some View {
        WorkspaceView(
            workspaceManager: env.workspaceManager,
            gazeRouter: gazeRouter,
            externalInstances: externalInstances,
            onAddInstance: { showAddInstance = true }
        )
    }

    @ViewBuilder
    private var symphonyNotificationsSection: some View {
        FileRequestNotificationView(
            requests: env.noteRelay.pendingFileRequests,
            onApprove: { id in
                _ = env.fileApprovalManager.approve(id, projectDir: FileManager.default.currentDirectoryPath)
            },
            onDeny: { id in
                env.fileApprovalManager.deny(id)
            },
            onApproveRedacted: { id in
                _ = env.fileApprovalManager.approve(id, projectDir: FileManager.default.currentDirectoryPath, redact: true)
            }
        )
        ApprovalNotificationBanner(monitor: env.symphonyMonitor)
    }

    @ViewBuilder
    private var teamThreadSection: some View {
        if !env.threadWatcher.teamThreads.isEmpty {
            Divider()
            TeamThreadView(
                threadWatcher: env.threadWatcher,
                monitor: env.symphonyMonitor
            )
        }
    }

    @ViewBuilder
    private var taskSection: some View {
        if !env.taskStore.tasks.isEmpty {
            Divider()
            TaskDashboardView(taskStore: env.taskStore, onSendNote: { note in
                for r in (note.recipients ?? []) {
                    ScoreIO.appendJsonl(note, to: ScoreIO.inboxPath(for: r.id))
                }
            })
        }
    }

    @ViewBuilder
    private var agentNetworkSection: some View {
        if !env.agentGroupStore.groups.isEmpty || !env.agentPartManager.registeredAgents.isEmpty {
            Divider()
            AgentNetworkView(
                groupStore: env.agentGroupStore,
                agentPartManager: env.agentPartManager,
                agentProcessManager: env.agentProcessManager,
                monitor: env.symphonyMonitor,
                relay: env.noteRelay,
                taskStore: env.taskStore,
                agentHealthMonitor: env.agentHealthMonitor
            )
        } else if !env.noteRelay.activeThreads.isEmpty {
            Divider()
            ThreadListView(relay: env.noteRelay)
        }
    }

    @ViewBuilder
    private var agentHealthSection: some View {
        if !env.agentHealthMonitor.metrics.isEmpty {
            Divider()
            AgentHealthView(healthMonitor: env.agentHealthMonitor)
        }
    }

    @ViewBuilder
    private var sentinelSection: some View {
        Divider()
        SentinelLiveView(sentinelClient: env.sentinelClient, taskStore: env.taskStore)
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
            await env.orchestrator.executeAction(.send)
        }
    }
}
