// ContainerView.swift — #container-view
// Root SwiftUI view for the workspace container.
// Renders tiling cells with chrome overlays, divider handles, and presets.

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

    @State private var layoutRoot: TileNode = .cell(.empty())
    @State private var showControlPanel = false
    @State private var controlPanelTab: ControlPanelTab = .workspace
    @State private var currentPreset: LayoutPreset? = .focused
    @State private var maximizedCellId: String?
    @State private var savedLayoutBeforeMaximize: TileNode?

    /// The gap between cells.
    private let cellGap: CGFloat = 8
    /// Header bar height.
    private let headerHeight: CGFloat = 36
    /// Status bar height.
    private let statusBarHeight: CGFloat = 28

    var body: some View {
        GeometryReader { geo in
            let contentArea = CGRect(
                x: cellGap,
                y: 0,
                width: geo.size.width - cellGap * 2,
                height: geo.size.height - headerHeight - statusBarHeight
            )

            ZStack(alignment: .topLeading) {
                // Background
                Color.clear
                    .background(.ultraThickMaterial)

                VStack(spacing: 0) {
                    // Header bar
                    containerHeader
                        .frame(height: headerHeight)

                    // Tiling area + control panel overlay
                    ZStack(alignment: .leading) {
                        tilingArea(contentArea: contentArea)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)

                        // Control panel overlay
                        ControlPanelContainer(
                            isVisible: $showControlPanel,
                            activeTab: $controlPanelTab,
                            projectStore: projectStore,
                            agentProcessManager: agentProcessManager,
                            workspaceManager: workspaceManager,
                            taskStore: taskStore,
                            agentGroupStore: agentGroupStore,
                            symphonyMonitor: symphonyMonitor,
                            sentinelClient: sentinelClient,
                            agentHealthMonitor: agentHealthMonitor
                        )
                    }

                    // Status bar
                    StatusBarView(
                        taskStore: taskStore,
                        sentinelClient: sentinelClient,
                        agentHealthMonitor: agentHealthMonitor,
                        onSelectTab: { tab in
                            controlPanelTab = tab
                            withAnimation { showControlPanel = true }
                        }
                    )
                    .frame(height: statusBarHeight)
                }
            }
        }
    }

    // MARK: - Tiling Area

    @ViewBuilder
    private func tilingArea(contentArea: CGRect) -> some View {
        ZStack {
            // Cell chrome overlays
            let frames = TilingEngine.computeFrames(root: layoutRoot, area: contentArea, gap: cellGap)
            ForEach(frames) { cellFrame in
                if cellFrame.instanceId == nil {
                    // Empty cell — show placeholder
                    EmptyCellView(
                        onLaunch: { launchInCell(cellFrame.id) },
                        onDrop: nil
                    )
                    .frame(width: cellFrame.frame.width, height: cellFrame.frame.height)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.secondary.opacity(0.15), style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
                    )
                    .position(x: cellFrame.frame.midX, y: cellFrame.frame.midY)
                } else {
                    // Active cell — show chrome
                    CellChromeView(
                        cellFrame: cellFrame,
                        onSplit: { axis in
                            withAnimation(.easeInOut(duration: 0.2)) {
                                layoutRoot = TilingEngine.splitCell(in: layoutRoot, cellId: cellFrame.id, axis: axis)
                                currentPreset = nil
                            }
                        },
                        onClose: {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                layoutRoot = TilingEngine.removeCell(in: layoutRoot, cellId: cellFrame.id)
                                currentPreset = nil
                            }
                        },
                        onMaximize: {
                            toggleMaximize(cellId: cellFrame.id)
                        }
                    )
                    .frame(width: cellFrame.frame.width, height: cellFrame.frame.height)
                    .position(x: cellFrame.frame.midX, y: cellFrame.frame.midY)
                }
            }

            // Divider handles
            let dividers = TilingEngine.computeDividers(root: layoutRoot, area: contentArea, gap: cellGap)
            ForEach(dividers) { divider in
                DividerHandle(
                    divider: divider,
                    onDrag: { delta in
                        handleDividerDrag(splitId: divider.id, delta: delta, axis: divider.axis, area: contentArea)
                    },
                    onDragEnd: {}
                )
                .position(x: divider.frame.midX, y: divider.frame.midY)
            }
        }
    }

    // MARK: - Header Bar

    private var containerHeader: some View {
        HStack(spacing: 8) {
            // Control panel toggle
            Button(action: { withAnimation { showControlPanel.toggle() } }) {
                Image(systemName: "sidebar.left")
                    .font(.system(size: 14))
                    .foregroundStyle(showControlPanel ? .blue : .secondary)
            }
            .buttonStyle(.borderless)

            Image(systemName: "waveform.badge.mic")
                .foregroundStyle(.cyan)
            Text("Conductor")
                .font(.system(size: 13, weight: .semibold))

            Spacer()

            // Layout presets strip
            LayoutPresetsView(currentPreset: $currentPreset) { preset in
                applyPreset(preset)
            }

            Divider()
                .frame(height: 16)

            // Instance count
            let allCells = TilingEngine.allCells(layoutRoot)
            let activeCells = allCells.filter { !$0.isEmpty }.count
            Text("\(activeCells) instance\(activeCells == 1 ? "" : "s")")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)

            // Status indicator
            Circle()
                .fill(.green)
                .frame(width: 8, height: 8)
        }
        .padding(.horizontal, 12)
        .background(.ultraThinMaterial)
    }

    // MARK: - Actions

    private func applyPreset(_ preset: LayoutPreset) {
        let existingCells = TilingEngine.allCells(layoutRoot)
        withAnimation(.easeInOut(duration: 0.25)) {
            layoutRoot = TilingEngine.preset(preset, cells: existingCells)
            maximizedCellId = nil
            savedLayoutBeforeMaximize = nil
        }
    }

    private func handleDividerDrag(splitId: String, delta: CGFloat, axis: SplitAxis, area: CGRect) {
        // Convert pixel delta to ratio delta
        let containerSize = axis == .horizontal ? area.width : area.height
        guard containerSize > 0 else { return }
        let ratioDelta = delta / containerSize

        // Find current ratio and update
        // Walk tree to find the split, get its current ratio, add delta
        if let currentRatio = findSplitRatio(in: layoutRoot, splitId: splitId) {
            let newRatio = currentRatio + ratioDelta
            let (snapped, _) = DividerHandle.snapRatio(newRatio, containerSize: containerSize)
            layoutRoot = TilingEngine.updateRatio(in: layoutRoot, splitId: splitId, ratio: snapped)
            currentPreset = nil
        }
    }

    private func findSplitRatio(in node: TileNode, splitId: String) -> CGFloat? {
        switch node {
        case .cell: return nil
        case .split(let state):
            if state.id == splitId { return state.ratio }
            return findSplitRatio(in: state.first, splitId: splitId) ?? findSplitRatio(in: state.second, splitId: splitId)
        }
    }

    private func toggleMaximize(cellId: String) {
        if maximizedCellId == cellId, let saved = savedLayoutBeforeMaximize {
            // Restore
            withAnimation(.easeInOut(duration: 0.2)) {
                layoutRoot = saved
                maximizedCellId = nil
                savedLayoutBeforeMaximize = nil
            }
        } else {
            // Maximize: save layout, replace with single focused cell
            let cell = TilingEngine.allCells(layoutRoot).first { $0.id == cellId }
            guard let cell else { return }
            withAnimation(.easeInOut(duration: 0.2)) {
                savedLayoutBeforeMaximize = layoutRoot
                layoutRoot = .cell(cell)
                maximizedCellId = cellId
            }
        }
    }

    private func launchInCell(_ cellId: String) {
        // TODO: Sprint 19 — show project picker, then assign instance to cell
        ConductorLog.component("container-view")
            .info("Launch requested for cell \(cellId)")
    }
}

// MARK: - Control Panel Tab

enum ControlPanelTab: String, CaseIterable {
    case workspace = "Workspace"
    case orchestrate = "Orchestrate"
    case monitor = "Monitor"
    case settings = "Settings"

    var icon: String {
        switch self {
        case .workspace: return "square.grid.2x2"
        case .orchestrate: return "target"
        case .monitor: return "chart.bar"
        case .settings: return "gear"
        }
    }
}
