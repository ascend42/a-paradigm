// ControlPanelContainer.swift — #control-panel-container
// Collapsible tabbed overlay panel for the workspace container.
// Tabs: Workspace, Orchestrate, Monitor, Settings.

import SwiftUI

struct ControlPanelContainer: View {
    @Binding var isVisible: Bool
    @Binding var activeTab: ControlPanelTab

    // Workspace tab dependencies
    @ObservedObject var projectStore: ProjectStore
    @ObservedObject var agentProcessManager: AgentProcessManager
    @ObservedObject var workspaceManager: WorkspaceManager

    // Orchestrate tab dependencies
    @ObservedObject var taskStore: TaskStore
    @ObservedObject var agentGroupStore: AgentGroupStore
    @ObservedObject var symphonyMonitor: SymphonyMonitor

    // Monitor tab dependencies
    @ObservedObject var sentinelClient: SentinelWSClient
    @ObservedObject var agentHealthMonitor: AgentHealthMonitor

    /// Panel width
    private let panelWidth: CGFloat = 320

    var body: some View {
        if isVisible {
            HStack(spacing: 0) {
                panelContent
                    .frame(width: panelWidth)
                    .background(.ultraThinMaterial)
                    .transition(.move(edge: .leading).combined(with: .opacity))

                // Dismiss area
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { withAnimation { isVisible = false } }
            }
            .transition(.opacity)
        }
    }

    private var panelContent: some View {
        VStack(spacing: 0) {
            // Tab bar
            tabBar

            Divider()

            // Tab content
            ScrollView {
                tabContent
                    .padding(12)
            }
        }
    }

    // MARK: - Tab Bar

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(ControlPanelTab.allCases, id: \.rawValue) { tab in
                Button(action: { activeTab = tab }) {
                    VStack(spacing: 2) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 14))
                        Text(tab.rawValue)
                            .font(.system(size: 8))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .foregroundStyle(activeTab == tab ? .blue : .secondary)
                    .background(activeTab == tab ? Color.blue.opacity(0.08) : Color.clear)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(height: 44)
    }

    // MARK: - Tab Content

    @ViewBuilder
    private var tabContent: some View {
        switch activeTab {
        case .workspace:
            workspaceTab
        case .orchestrate:
            orchestrateTab
        case .monitor:
            monitorTab
        case .settings:
            settingsTab
        }
    }

    // MARK: - Workspace Tab

    private var workspaceTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Recent Projects")
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
        }
    }

    // MARK: - Orchestrate Tab

    private var orchestrateTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !taskStore.tasks.isEmpty {
                sectionHeader("Tasks")
                TaskDashboardView(taskStore: taskStore)
            }

            if !agentGroupStore.groups.isEmpty {
                sectionHeader("Agent Groups")
                Text("\(agentGroupStore.groups.count) group(s)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if taskStore.tasks.isEmpty && agentGroupStore.groups.isEmpty {
                emptyState("No active tasks or groups", icon: "target")
            }
        }
    }

    // MARK: - Monitor Tab

    private var monitorTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Sentinel")
            SentinelLiveView(sentinelClient: sentinelClient, taskStore: taskStore)

            if !agentHealthMonitor.metrics.isEmpty {
                sectionHeader("Agent Health")
                AgentHealthView(healthMonitor: agentHealthMonitor)
            }
        }
    }

    // MARK: - Settings Tab

    private var settingsTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Workspace")
            HStack {
                Text("Max instances")
                    .font(.caption)
                Spacer()
                Text("\(workspaceManager.maxInstances)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("Auto-arrange")
                    .font(.caption)
                Spacer()
                Text(workspaceManager.autoArrange ? "On" : "Off")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            sectionHeader("Sentinel")
            HStack {
                Text("Server")
                    .font(.caption)
                Spacer()
                Text(sentinelClient.serverURL.absoluteString)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("Status")
                    .font(.caption)
                Spacer()
                Circle()
                    .fill(sentinelClient.isConnected ? .green : .red)
                    .frame(width: 6, height: 6)
                Text(sentinelClient.isConnected ? "Connected" : "Disconnected")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption.bold())
            .foregroundStyle(.secondary)
            .padding(.top, 4)
    }

    private func emptyState(_ message: String, icon: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(.tertiary)
            Text(message)
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}
