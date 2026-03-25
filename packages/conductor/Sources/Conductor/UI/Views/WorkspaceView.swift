// WorkspaceView.swift — #workspace-view
// Sidebar view for managing workspace instances.
// Replaces InstanceListView as the primary instance management UI.

import SwiftUI

struct WorkspaceView: View {
    @ObservedObject var workspaceManager: WorkspaceManager
    @ObservedObject var gazeRouter: GazeRouter
    var externalInstances: [ClaudeCodeInstance]
    let onAddInstance: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Section header
            HStack {
                Label("Workspace", systemImage: "square.grid.2x2")
                    .font(.subheadline.bold())
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(workspaceManager.managedInstances.count)")
                    .font(.caption)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        Capsule()
                            .fill(workspaceManager.managedInstances.isEmpty
                                  ? Color.gray.opacity(0.2)
                                  : ConductorTheme.brand.opacity(0.2))
                    )
            }

            // Grid minimap
            if !workspaceManager.managedInstances.isEmpty {
                gridMinimap
                    .frame(height: 60)
                    .padding(.vertical, 4)
            }

            // Managed instance list
            if workspaceManager.managedInstances.isEmpty {
                emptyState
            } else {
                managedInstanceList
            }

            // Add instance button
            Button(action: onAddInstance) {
                Label("Add Instance", systemImage: "plus.circle")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.small)
            .buttonStyle(.bordered)
            .disabled(workspaceManager.managedInstances.count >= workspaceManager.maxInstances)

            // External instances (non-Conductor-launched)
            if !externalInstances.isEmpty {
                externalSection
            }
        }
    }

    // MARK: - Grid Minimap

    private var gridMinimap: some View {
        GeometryReader { geo in
            let grid = workspaceManager.currentGrid()
            let scaleX = geo.size.width / grid.screenBounds.width
            let scaleY = geo.size.height / grid.screenBounds.height

            ZStack {
                // Sidebar indicator
                let sidebarRect = grid.sidebarFrame
                RoundedRectangle(cornerRadius: 2)
                    .fill(ConductorTheme.brand.opacity(0.2))
                    .frame(
                        width: sidebarRect.width * scaleX,
                        height: sidebarRect.height * scaleY
                    )
                    .position(
                        x: (sidebarRect.midX - grid.screenBounds.minX) * scaleX,
                        y: geo.size.height - (sidebarRect.midY - grid.screenBounds.minY) * scaleY
                    )

                // Grid cells
                ForEach(0..<workspaceManager.managedInstances.count, id: \.self) { index in
                    let cellRect = grid.cellFrame(at: index)
                    let managed = workspaceManager.managedInstances[index]
                    let isTargeted = gazeRouter.currentTarget?.processID == managed.processID

                    RoundedRectangle(cornerRadius: 2)
                        .fill(isTargeted ? ConductorTheme.healthy.opacity(0.3) : Color.secondary.opacity(0.15))
                        .overlay(
                            RoundedRectangle(cornerRadius: 2)
                                .stroke(isTargeted ? ConductorTheme.healthy : Color.secondary.opacity(0.3), lineWidth: 1)
                        )
                        .overlay(
                            Text("\(index + 1)")
                                .font(.caption2.bold())
                                .foregroundStyle(.secondary)
                        )
                        .frame(
                            width: cellRect.width * scaleX,
                            height: cellRect.height * scaleY
                        )
                        .position(
                            x: (cellRect.midX - grid.screenBounds.minX) * scaleX,
                            y: geo.size.height - (cellRect.midY - grid.screenBounds.minY) * scaleY
                        )
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(nsColor: .controlBackgroundColor))
            )
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "square.grid.2x2")
                .font(.title2)
                .foregroundStyle(.tertiary)
            Text("No managed instances")
                .font(.caption)
                .foregroundStyle(.tertiary)
            Text("Click + to launch Claude Code")
                .font(.caption2)
                .foregroundStyle(.quaternary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    // MARK: - Managed Instance List

    private var managedInstanceList: some View {
        ScrollView {
            LazyVStack(spacing: 4) {
                ForEach(workspaceManager.managedInstances) { managed in
                    managedInstanceRow(managed)
                }
            }
        }
        .frame(maxHeight: 180)
    }

    private func managedInstanceRow(_ managed: ManagedInstance) -> some View {
        let isTargeted = gazeRouter.currentTarget?.processID == managed.processID

        return HStack(spacing: 8) {
            // Grid index badge
            Text("\(managed.gridIndex + 1)")
                .font(.caption.bold().monospaced())
                .foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .background(Circle().fill(isTargeted ? ConductorTheme.healthy : Color.secondary))

            // Info
            VStack(alignment: .leading, spacing: 2) {
                Text(managed.label)
                    .font(.caption.bold())
                    .lineLimit(1)
                Text(managed.projectDirectory)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }

            Spacer()

            // Status
            if managed.isAlive {
                Circle()
                    .fill(ConductorTheme.healthy)
                    .frame(width: 6, height: 6)
                    .accessibilityLabel("Instance running")
            } else {
                Circle()
                    .fill(ConductorTheme.critical)
                    .frame(width: 6, height: 6)
                    .accessibilityLabel("Instance stopped")
            }

            // Close button
            Button(action: {
                workspaceManager.closeInstance(managed)
            }) {
                Image(systemName: "xmark.circle")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isTargeted
                      ? Color.accentColor.opacity(0.1)
                      : Color(nsColor: .controlBackgroundColor))
        )
        .onTapGesture {
            if let instance = managed.instance {
                // AX-linked instance — set as gaze target
                gazeRouter.setTarget(instance)
            } else if let pid = managed.processID {
                // Not yet AX-linked — activate the terminal window directly
                if let app = NSRunningApplication(processIdentifier: pid) {
                    app.activate()
                    ConductorLog.component("workspace-view")
                        .info("Activated terminal for \(managed.label) (PID \(pid))")
                }
            }
        }
    }

    // MARK: - External Instances

    private var externalSection: some View {
        DisclosureGroup {
            ForEach(externalInstances) { instance in
                HStack(spacing: 8) {
                    Circle()
                        .fill(.gray)
                        .frame(width: 6, height: 6)
                        .accessibilityLabel("External instance")
                    Text(instance.projectDirectory ?? instance.title)
                        .font(.caption2)
                        .lineLimit(1)
                    Spacer()
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
            }
        } label: {
            HStack {
                Label("External", systemImage: "arrow.uturn.down.circle")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Text("\(externalInstances.count)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}
