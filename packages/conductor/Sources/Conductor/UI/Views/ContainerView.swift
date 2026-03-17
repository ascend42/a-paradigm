// ContainerView.swift — #container-view
// Root SwiftUI view for the workspace container.
// Renders tiling cells with chrome overlays and divider handles.

import SwiftUI

struct ContainerView: View {
    @ObservedObject var workspaceManager: WorkspaceManager
    @ObservedObject var taskStore: TaskStore
    @ObservedObject var sentinelClient: SentinelWSClient
    @ObservedObject var agentHealthMonitor: AgentHealthMonitor

    @State private var layoutRoot: TileNode = .cell(.empty())
    @State private var showControlPanel = false
    @State private var controlPanelTab: ControlPanelTab = .workspace

    /// The gap between cells.
    private let cellGap: CGFloat = 8
    /// Header bar height.
    private let headerHeight: CGFloat = 36
    /// Status bar height.
    private let statusBarHeight: CGFloat = 28

    var body: some View {
        GeometryReader { geo in
            let contentArea = CGRect(
                x: 0,
                y: statusBarHeight,
                width: geo.size.width,
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

                    // Tiling area
                    ZStack {
                        // Cell chrome overlays
                        let frames = TilingEngine.computeFrames(root: layoutRoot, area: contentArea, gap: cellGap)
                        ForEach(frames) { cellFrame in
                            CellChromeView(
                                cellFrame: cellFrame,
                                onSplit: { axis in
                                    layoutRoot = TilingEngine.splitCell(in: layoutRoot, cellId: cellFrame.id, axis: axis)
                                },
                                onClose: {
                                    layoutRoot = TilingEngine.removeCell(in: layoutRoot, cellId: cellFrame.id)
                                }
                            )
                            .frame(width: cellFrame.frame.width, height: cellFrame.frame.height)
                            .position(x: cellFrame.frame.midX, y: cellFrame.frame.midY - statusBarHeight)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                    // Status bar
                    statusBar
                        .frame(height: statusBarHeight)
                }
            }
        }
    }

    // MARK: - Header Bar

    private var containerHeader: some View {
        HStack(spacing: 8) {
            // Control panel toggle
            Button(action: { showControlPanel.toggle() }) {
                Image(systemName: "sidebar.left")
                    .font(.system(size: 14))
                    .foregroundStyle(showControlPanel ? .blue : .secondary)
            }
            .buttonStyle(.borderless)

            Image(systemName: "waveform.badge.mic")
                .foregroundStyle(.cyan)
            Text("Conductor")
                .font(.system(size: 13, weight: .semibold))
            Text("v1.0")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)

            Spacer()

            // Instance count
            let cellCount = TilingEngine.cellCount(layoutRoot)
            let activeCells = TilingEngine.allCells(layoutRoot).filter { !$0.isEmpty }.count
            Text("\(activeCells)/\(cellCount) cells")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)

            // Layout presets
            Menu {
                ForEach(LayoutPreset.allCases, id: \.rawValue) { preset in
                    Button("⌘\(preset.shortcutIndex) \(preset.rawValue)") {
                        applyPreset(preset)
                    }
                }
            } label: {
                Image(systemName: "rectangle.3.group")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            .menuStyle(.borderlessButton)
            .frame(width: 28)

            // Status indicator
            Circle()
                .fill(.green)
                .frame(width: 8, height: 8)
        }
        .padding(.horizontal, 12)
        .background(.ultraThinMaterial)
    }

    // MARK: - Status Bar

    private var statusBar: some View {
        HStack(spacing: 16) {
            // Tasks
            let activeCount = taskStore.activeTasks.count
            if activeCount > 0 {
                HStack(spacing: 4) {
                    Image(systemName: "checklist")
                        .font(.system(size: 9))
                    Text("\(activeCount) active")
                        .font(.system(size: 9))
                }
                .foregroundStyle(.secondary)
            }

            // Sentinel
            HStack(spacing: 4) {
                Circle()
                    .fill(sentinelClient.isConnected ? .green : .gray)
                    .frame(width: 5, height: 5)
                Text("\(sentinelClient.recentEvents.count) events")
                    .font(.system(size: 9))
            }
            .foregroundStyle(.secondary)

            // Health
            if !agentHealthMonitor.metrics.isEmpty {
                let total = agentHealthMonitor.metrics.count
                HStack(spacing: 4) {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 8))
                    Text("\(total) agents")
                        .font(.system(size: 9))
                }
                .foregroundStyle(.secondary)
            }

            Spacer()

            Text("Conductor v1.0")
                .font(.system(size: 8))
                .foregroundStyle(.quaternary)
        }
        .padding(.horizontal, 12)
        .background(.ultraThinMaterial)
    }

    // MARK: - Actions

    private func applyPreset(_ preset: LayoutPreset) {
        let existingCells = TilingEngine.allCells(layoutRoot)
        layoutRoot = TilingEngine.preset(preset, cells: existingCells)
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
