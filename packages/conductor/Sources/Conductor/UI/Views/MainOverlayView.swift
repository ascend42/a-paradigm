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
    @ObservedObject var noteRelay: NoteRelay
    var fileApprovalManager: FileApprovalManager
    @ObservedObject var projectStore: ProjectStore
    @ObservedObject var agentProcessManager: AgentProcessManager
    @ObservedObject var agentGroupStore: AgentGroupStore
    @ObservedObject var symphonyMonitor: SymphonyMonitor
    @ObservedObject var agentPartManager: AgentPartManager

    @State private var showAddInstance = false

    init(showOnboarding: Bool, permissionStatus: PermissionStatus, orchestrator: InputOrchestrator, workspaceManager: WorkspaceManager, noteRelay: NoteRelay, fileApprovalManager: FileApprovalManager, projectStore: ProjectStore, agentProcessManager: AgentProcessManager, agentGroupStore: AgentGroupStore, symphonyMonitor: SymphonyMonitor, agentPartManager: AgentPartManager) {
        self._showOnboarding = State(initialValue: showOnboarding)
        self.permissionStatus = permissionStatus
        self.orchestrator = orchestrator
        self.workspaceManager = workspaceManager
        self.noteRelay = noteRelay
        self.fileApprovalManager = fileApprovalManager
        self.projectStore = projectStore
        self.agentProcessManager = agentProcessManager
        self.agentGroupStore = agentGroupStore
        self.symphonyMonitor = symphonyMonitor
        self.agentPartManager = agentPartManager
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

            // Session manager (recent projects + headless agents)
            SessionManagerView(
                projectStore: projectStore,
                agentManager: agentProcessManager,
                onLaunchInTerminal: { projectPath in
                    Task {
                        try? await workspaceManager.launchInstance(
                            projectDir: projectPath,
                            label: CheckpointReader.projectName(for: projectPath)
                        )
                    }
                }
            )

            Divider()

            // Workspace view (managed instances + external)
            WorkspaceView(
                workspaceManager: workspaceManager,
                gazeRouter: gazeRouter,
                externalInstances: externalInstances,
                onAddInstance: { showAddInstance = true }
            )

            // Symphony: file request notifications
            FileRequestNotificationView(
                requests: noteRelay.pendingFileRequests,
                onApprove: { id in
                    _ = fileApprovalManager.approve(id, projectDir: FileManager.default.currentDirectoryPath)
                },
                onDeny: { id in
                    fileApprovalManager.deny(id)
                },
                onApproveRedacted: { id in
                    _ = fileApprovalManager.approve(id, projectDir: FileManager.default.currentDirectoryPath, redact: true)
                }
            )

            // Approval notification banner (task protocol)
            ApprovalNotificationBanner(monitor: symphonyMonitor)

            // Agent network (groups + Symphony status)
            if !agentGroupStore.groups.isEmpty || !agentPartManager.registeredAgents.isEmpty {
                Divider()
                AgentNetworkView(
                    groupStore: agentGroupStore,
                    agentPartManager: agentPartManager,
                    agentProcessManager: agentProcessManager,
                    monitor: symphonyMonitor,
                    relay: noteRelay
                )
            } else if !noteRelay.activeThreads.isEmpty {
                // Fallback to simple thread list when no groups exist
                Divider()
                ThreadListView(relay: noteRelay)
            }

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
