// ContainerView.swift — #container-view
// Root SwiftUI view for the workspace container.
// Layout: collapsible left sidebar + composable NxM grid for terminal cells.

import SwiftUI

struct ContainerView: View {
    @ObservedObject var workspaceManager: WorkspaceManager
    @ObservedObject var taskStore: TaskStore
    @ObservedObject var sentinelClient: SentinelWSClient
    @ObservedObject var agentHealthMonitor: AgentHealthMonitor
    @ObservedObject var projectStore: ProjectStore
    @ObservedObject var agentProcessManager: AgentProcessManager
    @ObservedObject var agentGroupStore: AgentGroupStore
    @ObservedObject var symphonyMonitor: SymphonyMonitor
    @ObservedObject var threadWatcher: SymphonyThreadWatcher
    @ObservedObject var noteRelay: NoteRelay

    @State private var gridPreset: GridPreset = .twoByOne
    @State private var showSidebar = true
    @State private var showHelp = false
    @State private var sidebarTab: SidebarTab = .sessions

    /// The gap between cells.
    private let cellGap: CGFloat = 8
    /// Header bar height.
    private let headerHeight: CGFloat = 36
    /// Status bar height.
    private let statusBarHeight: CGFloat = 28
    /// Sidebar width when visible.
    private let sidebarWidth: CGFloat = 320

    var body: some View {
        VStack(spacing: 0) {
            // Header bar
            containerHeader
                .frame(height: headerHeight)

            // Main content: sidebar + grid
            HStack(spacing: 0) {
                if showSidebar {
                    sidebarPanel
                        .frame(width: sidebarWidth)
                        .transition(.move(edge: .leading))

                    Divider()
                }

                // Grid area
                gridArea
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            // Status bar
            StatusBarView(
                taskStore: taskStore,
                sentinelClient: sentinelClient,
                agentHealthMonitor: agentHealthMonitor,
                onSelectTab: { _ in }
            )
            .frame(height: statusBarHeight)
        }
        .background(.ultraThickMaterial)
    }

    // MARK: - Header Bar

    private var containerHeader: some View {
        HStack(spacing: 8) {
            // Sidebar toggle
            Button(action: { withAnimation(.easeInOut(duration: 0.2)) { showSidebar.toggle() } }) {
                Image(systemName: "sidebar.left")
                    .font(.system(size: 14))
                    .foregroundStyle(showSidebar ? .blue : .secondary)
            }
            .buttonStyle(.borderless)
            .help(showSidebar ? "Hide sidebar" : "Show sidebar")

            Image(systemName: "waveform.badge.mic")
                .foregroundStyle(.cyan)
            Text("Conductor")
                .font(.system(size: 13, weight: .semibold))

            Spacer()

            // Grid preset picker
            gridPresetPicker

            Divider()
                .frame(height: 16)

            // Instance count
            let instanceCount = workspaceManager.managedInstances.count
            Text("\(instanceCount)/\(gridPreset.totalCells) cells")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)

            // Help button
            Button(action: { showHelp = true }) {
                Image(systemName: "questionmark.circle")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
            .help("Conductor Guide")
            .sheet(isPresented: $showHelp) {
                HelpView(isPresented: $showHelp)
            }

            // Status indicator
            Circle()
                .fill(.green)
                .frame(width: 8, height: 8)
        }
        .padding(.horizontal, 12)
        .background(.ultraThinMaterial)
    }

    // MARK: - Grid Preset Picker

    private var gridPresetPicker: some View {
        HStack(spacing: 4) {
            ForEach(GridPreset.allPresets, id: \.self) { preset in
                Button(action: {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        gridPreset = preset
                    }
                }) {
                    gridPresetIcon(preset)
                        .frame(width: 28, height: 20)
                        .background(
                            RoundedRectangle(cornerRadius: 4)
                                .fill(gridPreset == preset
                                    ? Color.blue.opacity(0.2)
                                    : Color.clear)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .strokeBorder(gridPreset == preset
                                    ? Color.blue.opacity(0.4)
                                    : Color.secondary.opacity(0.2), lineWidth: 1)
                        )
                }
                .buttonStyle(.borderless)
                .help(preset.label)
            }
        }
    }

    /// Mini grid icon representing the preset layout.
    private func gridPresetIcon(_ preset: GridPreset) -> some View {
        let cols = preset.columns
        let rows = preset.rows
        let spacing: CGFloat = 1.5

        return VStack(spacing: spacing) {
            ForEach(0..<rows, id: \.self) { _ in
                HStack(spacing: spacing) {
                    ForEach(0..<cols, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(gridPreset == preset ? Color.blue : Color.secondary.opacity(0.5))
                    }
                }
            }
        }
        .padding(3)
    }

    // MARK: - Sidebar

    private var sidebarPanel: some View {
        VStack(spacing: 0) {
            // Tab bar
            HStack(spacing: 0) {
                ForEach(SidebarTab.allCases, id: \.self) { tab in
                    Button(action: { sidebarTab = tab }) {
                        VStack(spacing: 2) {
                            Image(systemName: tab.icon)
                                .font(.system(size: 12))
                            Text(tab.title)
                                .font(.system(size: 9))
                        }
                        .foregroundStyle(sidebarTab == tab ? .blue : .secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background(sidebarTab == tab ? Color.blue.opacity(0.08) : Color.clear)
                    }
                    .buttonStyle(.borderless)
                }
            }
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            // Tab content
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    sidebarContent
                }
                .padding(8)
            }
        }
        .background(.ultraThinMaterial)
    }

    @ViewBuilder
    private var sidebarContent: some View {
        switch sidebarTab {
        case .sessions:
            SessionManagerView(
                projectStore: projectStore,
                agentManager: agentProcessManager,
                agentGroupStore: agentGroupStore,
                onLaunchInTerminal: { projectPath in
                    Task {
                        try? await workspaceManager.launchInstance(
                            projectDir: projectPath,
                            label: CheckpointReader.projectName(for: projectPath)
                        )
                    }
                }
            )

        case .monitor:
            if !agentGroupStore.groups.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Linked Groups", systemImage: "link.circle")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    ForEach(agentGroupStore.groups) { group in
                        HStack {
                            Circle().fill(Color.blue).frame(width: 6, height: 6)
                            Text(group.name)
                                .font(.caption)
                            Spacer()
                            Text("\(group.agents.count) agents")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }

            // Live orchestration threads
            if !threadWatcher.teamThreads.isEmpty {
                TeamThreadView(
                    threadWatcher: threadWatcher,
                    monitor: symphonyMonitor
                )
            }

            if !taskStore.tasks.isEmpty {
                TaskDashboardView(taskStore: taskStore)
            }

            AgentHealthView(healthMonitor: agentHealthMonitor)

        case .sentinel:
            SentinelLiveView(sentinelClient: sentinelClient)

        case .settings:
            WorkspaceSettingsView(workspaceManager: workspaceManager)
        }
    }

    // MARK: - Grid Area

    private var gridArea: some View {
        GeometryReader { geo in
            let cellWidth = (geo.size.width - CGFloat(gridPreset.columns + 1) * cellGap) / CGFloat(gridPreset.columns)
            let cellHeight = (geo.size.height - CGFloat(gridPreset.rows + 1) * cellGap) / CGFloat(gridPreset.rows)

            ZStack(alignment: .topLeading) {
                // Grid cells
                ForEach(0..<gridPreset.totalCells, id: \.self) { index in
                    let col = index % gridPreset.columns
                    let row = index / gridPreset.columns
                    let x = cellGap + CGFloat(col) * (cellWidth + cellGap)
                    let y = cellGap + CGFloat(row) * (cellHeight + cellGap)

                    let instance = index < workspaceManager.managedInstances.count
                        ? workspaceManager.managedInstances[index]
                        : nil

                    gridCell(index: index, instance: instance)
                        .frame(width: cellWidth, height: cellHeight)
                        .position(x: x + cellWidth / 2, y: y + cellHeight / 2)
                }
            }
        }
    }

    @ViewBuilder
    private func gridCell(index: Int, instance: ManagedInstance?) -> some View {
        if let instance {
            // Active cell — instance info
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Circle()
                        .fill(instance.isAlive ? Color.green : Color.red)
                        .frame(width: 8, height: 8)
                    Text(instance.label)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                    Spacer()
                    Text("Cell \(index + 1)")
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                }

                Text(instance.projectDirectory)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)

                Spacer()

                HStack {
                    Text(instance.terminalApp.rawValue)
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                    Spacer()
                    Button("Close") {
                        workspaceManager.closeInstance(instance)
                    }
                    .controlSize(.mini)
                    .buttonStyle(.bordered)
                    .tint(.red)
                }
            }
            .padding(8)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(nsColor: .controlBackgroundColor))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(Color.green.opacity(0.3), lineWidth: 1)
            )
        } else {
            // Empty cell — placeholder
            VStack(spacing: 8) {
                Image(systemName: "plus.rectangle.on.rectangle")
                    .font(.title2)
                    .foregroundStyle(.tertiary)
                Text("Cell \(index + 1)")
                    .font(.caption2)
                    .foregroundStyle(.quaternary)
                Text("Launch a session to fill")
                    .font(.caption2)
                    .foregroundStyle(.quaternary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.secondary.opacity(0.15), style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
            )
        }
    }
}

// MARK: - Sidebar Tabs

enum SidebarTab: String, CaseIterable {
    case sessions
    case monitor
    case sentinel
    case settings

    var title: String {
        switch self {
        case .sessions: return "Sessions"
        case .monitor: return "Monitor"
        case .sentinel: return "Sentinel"
        case .settings: return "Settings"
        }
    }

    var icon: String {
        switch self {
        case .sessions: return "bolt.fill"
        case .monitor: return "chart.bar"
        case .sentinel: return "shield"
        case .settings: return "gear"
        }
    }
}
