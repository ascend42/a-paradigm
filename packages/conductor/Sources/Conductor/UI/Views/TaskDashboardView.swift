// TaskDashboardView.swift — #task-dashboard-view
// Kanban-style task dashboard showing active, blocked, awaiting approval, and completed tasks.

import SwiftUI

struct TaskDashboardView: View {
    @ObservedObject var taskStore: TaskStore
    var onSendNote: ((SymphonyNote) -> Void)?

    @State private var filterPriority: TaskPriority? = nil
    @State private var selectedTask: TaskRecord? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Label("Tasks", systemImage: "checklist")
                    .font(.subheadline.bold())
                    .foregroundStyle(.secondary)

                // Archive badge
                if taskStore.archivedCount > 0 {
                    Text("\(taskStore.archivedCount) archived")
                        .font(.system(size: ConductorTheme.fontXS))
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(.quaternary))
                }

                Spacer()

                // Task counts
                HStack(spacing: 6) {
                    countBadge(taskStore.activeTasks.count, color: ConductorTheme.active, label: "active")
                    countBadge(taskStore.blockedTasks.count, color: ConductorTheme.critical, label: "blocked")
                    countBadge(taskStore.awaitingApprovalTasks.count, color: ConductorTheme.warning, label: "pending")
                }

                // Archive menu
                Menu {
                    Button("Archive Older than 7d") {
                        taskStore.archiveCompleted()
                    }
                    Button("Archive All Completed") {
                        taskStore.pruneCompleted()
                    }
                } label: {
                    Image(systemName: "archivebox")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
                .frame(width: 20)

                // Priority filter
                Picker("", selection: $filterPriority) {
                    Text("All").tag(nil as TaskPriority?)
                    Text("Critical").tag(TaskPriority.critical as TaskPriority?)
                    Text("High").tag(TaskPriority.high as TaskPriority?)
                    Text("Normal").tag(TaskPriority.normal as TaskPriority?)
                    Text("Low").tag(TaskPriority.low as TaskPriority?)
                }
                .labelsHidden()
                .frame(width: 80)
                .controlSize(.small)
            }

            // Kanban columns (stacked vertically for sidebar)
            ScrollView {
                LazyVStack(spacing: 6) {
                    if !filtered(taskStore.activeTasks).isEmpty {
                        columnHeader("Active", systemImage: "play.circle", color: ConductorTheme.active)
                        ForEach(filtered(taskStore.activeTasks)) { task in
                            taskCard(task)
                        }
                    }

                    if !filtered(taskStore.blockedTasks).isEmpty {
                        columnHeader("Blocked", systemImage: "exclamationmark.triangle", color: ConductorTheme.critical)
                        ForEach(filtered(taskStore.blockedTasks)) { task in
                            taskCard(task)
                        }
                    }

                    if !filtered(taskStore.awaitingApprovalTasks).isEmpty {
                        columnHeader("Awaiting Approval", systemImage: "clock.badge.questionmark", color: ConductorTheme.warning)
                        ForEach(filtered(taskStore.awaitingApprovalTasks)) { task in
                            taskCard(task)
                        }
                    }

                    if !filtered(taskStore.completedTasks).isEmpty {
                        columnHeader("Complete", systemImage: "checkmark.circle", color: ConductorTheme.healthy)
                        ForEach(filtered(taskStore.completedTasks).suffix(5)) { task in
                            taskCard(task)
                        }
                    }
                }
            }
            .frame(maxHeight: 400)
        }
        .sheet(item: $selectedTask) { task in
            TaskDetailView(
                task: task,
                taskStore: taskStore,
                onViewThread: { _ in
                    // Thread viewing handled by parent view
                },
                onCancel: { id in
                    taskStore.cancelTask(id: id)
                },
                onReassign: { id, newAssignees in
                    taskStore.reassignTask(id: id, to: newAssignees) { note in
                        onSendNote?(note)
                    }
                }
            )
        }
    }

    // MARK: - Subviews

    private func countBadge(_ count: Int, color: Color, label: String) -> some View {
        Group {
            if count > 0 {
                Text("\(count)")
                    .font(.system(size: ConductorTheme.fontSM, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(color))
                    .help("\(count) \(label)")
            }
        }
    }

    private func columnHeader(_ title: String, systemImage: String, color: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage)
                .foregroundStyle(color)
                .font(.system(size: 10))
            Text(title)
                .font(.caption2.bold())
                .foregroundStyle(color)
            Spacer()
        }
        .padding(.top, 4)
    }

    private func taskCard(_ task: TaskRecord) -> some View {
        Button(action: { selectedTask = task }) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(task.id.suffix(8))
                        .font(.system(size: ConductorTheme.fontSM, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Spacer()
                    priorityBadge(task.priority)
                }

                Text(task.scope)
                    .font(.caption)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .foregroundStyle(.primary)

                HStack(spacing: 6) {
                    // Assignee
                    if let first = task.assignedTo.first {
                        HStack(spacing: 2) {
                            Image(systemName: "person")
                                .font(.system(size: ConductorTheme.fontXS))
                            Text(first.components(separatedBy: "/").last ?? first)
                                .font(.system(size: ConductorTheme.fontSM))
                        }
                        .foregroundStyle(.secondary)
                    }

                    Spacer()

                    // Progress bar
                    if task.status != .complete && task.status != .failed {
                        HStack(spacing: 4) {
                            ProgressView(value: Double(task.progress), total: 100)
                                .frame(width: 40)
                                .controlSize(.mini)
                            Text("\(task.progress)%")
                                .font(.system(size: ConductorTheme.fontXS, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        statusBadge(task.status)
                    }
                }
            }
            .padding(6)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(.background)
                    .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(statusColor(task.status).opacity(0.2), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func priorityBadge(_ priority: TaskPriority) -> some View {
        Text(priority.rawValue.capitalized)
            .font(.system(size: ConductorTheme.fontXS, weight: .medium))
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(
                Capsule().fill(priorityColor(priority).opacity(0.15))
            )
            .foregroundStyle(priorityColor(priority))
    }

    private func statusBadge(_ status: TaskStatus) -> some View {
        HStack(spacing: 2) {
            Image(systemName: status == .complete ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(.system(size: ConductorTheme.fontXS))
            Text(status == .complete ? "Done" : "Failed")
                .font(.system(size: ConductorTheme.fontXS))
        }
        .foregroundStyle(status == .complete ? ConductorTheme.healthy : ConductorTheme.critical)
    }

    // MARK: - Helpers

    private func filtered(_ tasks: [TaskRecord]) -> [TaskRecord] {
        guard let priority = filterPriority else { return tasks }
        return tasks.filter { $0.priority == priority }
    }

    private func priorityColor(_ priority: TaskPriority) -> Color {
        ConductorColors.priorityColor(priority)
    }

    private func statusColor(_ status: TaskStatus) -> Color {
        ConductorColors.statusColor(status)
    }
}

// MARK: - TaskRecord Identifiable for sheet

extension TaskRecord: @retroactive Hashable {
    static func == (lhs: TaskRecord, rhs: TaskRecord) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}
