// ConductorEnvironment.swift — #conductor-environment
// Consolidates all shared manager objects into a single environment object.
// Views receive one @EnvironmentObject instead of many @ObservedObject properties.

import SwiftUI

@MainActor
final class ConductorEnvironment: ObservableObject {
    @Published var orchestrator: InputOrchestrator
    @Published var workspaceManager: WorkspaceManager
    @Published var noteRelay: NoteRelay
    @Published var fileApprovalManager: FileApprovalManager
    @Published var projectStore: ProjectStore
    @Published var agentProcessManager: AgentProcessManager
    @Published var agentGroupStore: AgentGroupStore
    @Published var symphonyMonitor: SymphonyMonitor
    @Published var agentPartManager: AgentPartManager
    @Published var taskStore: TaskStore
    @Published var sentinelClient: SentinelWSClient
    @Published var agentHealthMonitor: AgentHealthMonitor
    @Published var threadWatcher: SymphonyThreadWatcher
    @Published var symphonyNotifications: SymphonyNotificationManager
    @Published var terminalSessionManager: TerminalSessionManager

    init(
        orchestrator: InputOrchestrator,
        workspaceManager: WorkspaceManager,
        noteRelay: NoteRelay,
        fileApprovalManager: FileApprovalManager,
        projectStore: ProjectStore,
        agentProcessManager: AgentProcessManager,
        agentGroupStore: AgentGroupStore,
        symphonyMonitor: SymphonyMonitor,
        agentPartManager: AgentPartManager,
        taskStore: TaskStore,
        sentinelClient: SentinelWSClient,
        agentHealthMonitor: AgentHealthMonitor,
        threadWatcher: SymphonyThreadWatcher,
        symphonyNotifications: SymphonyNotificationManager,
        terminalSessionManager: TerminalSessionManager
    ) {
        self.orchestrator = orchestrator
        self.workspaceManager = workspaceManager
        self.noteRelay = noteRelay
        self.fileApprovalManager = fileApprovalManager
        self.projectStore = projectStore
        self.agentProcessManager = agentProcessManager
        self.agentGroupStore = agentGroupStore
        self.symphonyMonitor = symphonyMonitor
        self.agentPartManager = agentPartManager
        self.taskStore = taskStore
        self.sentinelClient = sentinelClient
        self.agentHealthMonitor = agentHealthMonitor
        self.threadWatcher = threadWatcher
        self.symphonyNotifications = symphonyNotifications
        self.terminalSessionManager = terminalSessionManager
    }
}
