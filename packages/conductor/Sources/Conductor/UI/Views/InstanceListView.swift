// InstanceListView.swift — #instance-list-view
// SwiftUI list of detected Claude Code instances with status badges.

import SwiftUI

struct InstanceListView: View {
    /// Merged instances from all detection sources.
    var instances: [ClaudeCodeInstance]
    @ObservedObject var gazeRouter: GazeRouter

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Claude Code Instances", systemImage: "terminal")
                    .font(.subheadline.bold())
                    .foregroundStyle(.secondary)

                Spacer()

                Text("\(instances.count)")
                    .font(.caption)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        Capsule()
                            .fill(instances.isEmpty ? Color.gray.opacity(0.2) : Color.green.opacity(0.2))
                    )
            }

            if instances.isEmpty {
                emptyState
            } else {
                instanceList
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "terminal")
                .font(.title2)
                .foregroundStyle(.tertiary)
            Text("No Claude Code sessions detected")
                .font(.caption)
                .foregroundStyle(.tertiary)
            Text("Run /conduct in Claude Code to register")
                .font(.caption2)
                .foregroundStyle(.quaternary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
    }

    // MARK: - Instance List

    private var instanceList: some View {
        ScrollView {
            LazyVStack(spacing: 4) {
                ForEach(instances) { instance in
                    instanceRow(instance)
                }
            }
        }
        .frame(maxHeight: 200)
    }

    private func instanceRow(_ instance: ClaudeCodeInstance) -> some View {
        let isTargeted = gazeRouter.currentTarget?.id == instance.id

        return Button(action: {
            gazeRouter.setTarget(instance)
        }) {
            HStack(spacing: 8) {
                // Status indicator
                statusIcon(for: instance.status)

                // Info
                VStack(alignment: .leading, spacing: 2) {
                    Text(instance.projectDirectory ?? instance.title)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.head)

                    Text("PID \(instance.processID)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Spacer()

                // Agent count badge
                if instance.agentCount > 0 {
                    Text("\(instance.agentCount)")
                        .font(.caption2.bold())
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(
                            Capsule()
                                .fill(Color.purple.opacity(0.3))
                        )
                }

                // Target indicator
                if isTargeted {
                    Image(systemName: "target")
                        .foregroundStyle(.green)
                        .font(.caption)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isTargeted
                        ? Color.accentColor.opacity(0.1)
                        : Color(nsColor: .controlBackgroundColor))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(isTargeted ? Color.accentColor.opacity(0.3) : .clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func statusIcon(for status: InstanceStatus) -> some View {
        switch status {
        case .idle:
            Circle()
                .fill(.gray)
                .frame(width: 8, height: 8)
        case .processing:
            Image(systemName: "circle.dotted")
                .foregroundStyle(.orange)
                .font(.caption2)
        case .finished:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.caption2)
        case .unknown:
            Circle()
                .fill(.gray.opacity(0.5))
                .frame(width: 8, height: 8)
        }
    }
}
