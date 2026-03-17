// TaskDetailView.swift — #task-detail-view
// Full task detail view with timeline, files, symbols, blockers, and actions.

import SwiftUI

struct TaskDetailView: View {
    let task: TaskRecord
    @ObservedObject var taskStore: TaskStore
    var onViewThread: ((String) -> Void)?
    var onCancel: ((String) -> Void)?
    var onReassign: ((String, [String]) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var showCancelConfirm = false
    @State private var showReassignSheet = false

    private var isActive: Bool {
        ![TaskStatus.complete, .failed].contains(task.status)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                Text("Task Detail")
                    .font(.headline)
                Spacer()
                statusPill(task.status)
            }

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // ID + Priority
                    HStack {
                        Text(task.id)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(task.priority.rawValue.capitalized)
                            .font(.caption.bold())
                            .foregroundStyle(priorityColor(task.priority))
                    }

                    // Scope
                    sectionHeader("Scope")
                    Text(task.scope)
                        .font(.caption)
                        .textSelection(.enabled)

                    // Acceptance criteria
                    sectionHeader("Acceptance Criteria")
                    Text(task.acceptance)
                        .font(.caption)
                        .textSelection(.enabled)

                    // Assignees
                    sectionHeader("Assigned To")
                    ForEach(task.assignedTo, id: \.self) { agentId in
                        HStack(spacing: 4) {
                            Image(systemName: "person.circle")
                                .font(.system(size: 10))
                            Text(agentId)
                                .font(.caption)
                        }
                        .foregroundStyle(.secondary)
                    }

                    // Progress
                    if task.status != .complete && task.status != .failed {
                        sectionHeader("Progress")
                        HStack {
                            ProgressView(value: Double(task.progress), total: 100)
                            Text("\(task.progress)%")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }

                    // Blockers
                    if !task.blockers.isEmpty {
                        sectionHeader("Blockers")
                        ForEach(task.blockers, id: \.self) { blocker in
                            HStack(spacing: 4) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.system(size: 9))
                                    .foregroundStyle(.red)
                                Text(blocker)
                                    .font(.caption)
                            }
                        }
                    }

                    // Files modified
                    if !task.filesModified.isEmpty {
                        sectionHeader("Files Modified (\(task.filesModified.count))")
                        ForEach(task.filesModified.prefix(20), id: \.self) { file in
                            Text(file)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        if task.filesModified.count > 20 {
                            Text("... and \(task.filesModified.count - 20) more")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }

                    // Symbols touched
                    if !task.symbolsTouched.isEmpty {
                        sectionHeader("Symbols Touched")
                        FlowLayout(spacing: 4) {
                            ForEach(task.symbolsTouched, id: \.self) { symbol in
                                Text(symbol)
                                    .font(.system(size: 9, design: .monospaced))
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 2)
                                    .background(RoundedRectangle(cornerRadius: 3).fill(.purple.opacity(0.1)))
                                    .foregroundStyle(.purple)
                            }
                        }
                    }

                    // Timeline
                    sectionHeader("Timeline")
                    ForEach(task.timeline.reversed()) { event in
                        timelineRow(event)
                    }

                    // External ref
                    if let ref = task.externalRef, !ref.isEmpty {
                        sectionHeader("External Reference")
                        Text(ref)
                            .font(.caption)
                            .foregroundStyle(.blue)
                            .textSelection(.enabled)
                    }
                }
            }

            Divider()

            // Actions
            HStack(spacing: 8) {
                if isActive {
                    Button(role: .destructive) {
                        showCancelConfirm = true
                    } label: {
                        Label("Cancel Task", systemImage: "xmark.circle")
                    }
                    .controlSize(.small)

                    Button {
                        showReassignSheet = true
                    } label: {
                        Label("Re-assign", systemImage: "arrow.triangle.swap")
                    }
                    .controlSize(.small)
                }

                Button {
                    let threadId = "thr-\(task.id)"
                    onViewThread?(threadId)
                    dismiss()
                } label: {
                    Label("View Thread", systemImage: "bubble.left.and.bubble.right")
                }
                .controlSize(.small)

                Spacer()
                Button("Close") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding()
        .frame(width: 450)
        .frame(minHeight: 400)
        .confirmationDialog("Cancel this task?", isPresented: $showCancelConfirm) {
            Button("Cancel Task", role: .destructive) {
                onCancel?(task.id)
                dismiss()
            }
            Button("Keep Task", role: .cancel) {}
        } message: {
            Text("This will mark the task as failed. This action cannot be undone.")
        }
        .sheet(isPresented: $showReassignSheet) {
            ReassignSheet(task: task, onReassign: { newAssignees in
                onReassign?(task.id, newAssignees)
                dismiss()
            })
        }
    }

    // MARK: - Subviews

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption.bold())
            .foregroundStyle(.secondary)
            .padding(.top, 2)
    }

    private func statusPill(_ status: TaskStatus) -> some View {
        Text(statusLabel(status))
            .font(.system(size: 10, weight: .medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                Capsule().fill(statusColor(status).opacity(0.15))
            )
            .foregroundStyle(statusColor(status))
    }

    private func timelineRow(_ event: TaskTimelineEvent) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: timelineIcon(event.type))
                .font(.system(size: 10))
                .foregroundStyle(timelineColor(event.type))
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 1) {
                Text(event.summary)
                    .font(.caption)
                    .lineLimit(3)

                HStack(spacing: 4) {
                    Text(event.timestamp, style: .relative)
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)

                    if let percent = event.percent {
                        Text("\(percent)%")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - Helpers

    private func timelineIcon(_ type: String) -> String {
        switch type {
        case "created": return "plus.circle"
        case "acknowledged": return "hand.thumbsup"
        case "progress": return "arrow.forward.circle"
        case "blocked": return "exclamationmark.triangle"
        case "approval": return "questionmark.circle"
        case "complete": return "checkmark.circle.fill"
        case "failed": return "xmark.circle.fill"
        case "cancelled": return "xmark.circle"
        case "reassigned": return "arrow.triangle.swap"
        default: return "circle"
        }
    }

    private func timelineColor(_ type: String) -> Color {
        switch type {
        case "created": return .blue
        case "acknowledged": return .cyan
        case "progress": return .green
        case "blocked": return .red
        case "approval": return .orange
        case "complete": return .green
        case "failed": return .red
        case "cancelled": return .orange
        case "reassigned": return .cyan
        default: return .secondary
        }
    }

    private func statusLabel(_ status: TaskStatus) -> String {
        switch status {
        case .assigned: return "Assigned"
        case .acknowledged: return "Acknowledged"
        case .inProgress: return "In Progress"
        case .blocked: return "Blocked"
        case .awaitingApproval: return "Awaiting Approval"
        case .complete: return "Complete"
        case .failed: return "Failed"
        }
    }

    private func statusColor(_ status: TaskStatus) -> Color {
        switch status {
        case .assigned: return .blue
        case .acknowledged: return .cyan
        case .inProgress: return .green
        case .blocked: return .red
        case .awaitingApproval: return .orange
        case .complete: return .green
        case .failed: return .red
        }
    }

    private func priorityColor(_ priority: TaskPriority) -> Color {
        switch priority {
        case .critical: return .red
        case .high: return .orange
        case .normal: return .blue
        case .low: return .secondary
        }
    }
}

// MARK: - Reassign Sheet

struct ReassignSheet: View {
    let task: TaskRecord
    let onReassign: ([String]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var agentInput = ""
    @State private var selectedAgents: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Re-assign Task")
                .font(.headline)

            Text("Current: \(task.assignedTo.joined(separator: ", "))")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                TextField("Agent ID (e.g. project/agent)", text: $agentInput)
                    .textFieldStyle(.roundedBorder)
                Button("Add") {
                    let trimmed = agentInput.trimmingCharacters(in: .whitespaces)
                    if !trimmed.isEmpty && !selectedAgents.contains(trimmed) {
                        selectedAgents.append(trimmed)
                        agentInput = ""
                    }
                }
                .disabled(agentInput.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            if !selectedAgents.isEmpty {
                ForEach(selectedAgents, id: \.self) { agent in
                    HStack {
                        Image(systemName: "person.circle")
                            .font(.system(size: 10))
                        Text(agent)
                            .font(.caption)
                        Spacer()
                        Button {
                            selectedAgents.removeAll { $0 == agent }
                        } label: {
                            Image(systemName: "xmark.circle")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }

            HStack {
                Button("Cancel") { dismiss() }
                Spacer()
                Button("Re-assign") {
                    onReassign(selectedAgents)
                }
                .disabled(selectedAgents.isEmpty)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
        .frame(width: 350)
    }
}

// MARK: - Flow Layout (for symbol tags)

struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layout(in: proposal.width ?? 0, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(in: bounds.width, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func layout(in width: CGFloat, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > width && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: width, height: y + rowHeight), positions)
    }
}
