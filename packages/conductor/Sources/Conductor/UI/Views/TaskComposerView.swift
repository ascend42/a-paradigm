// TaskComposerView.swift — #task-composer-view
// UI for creating and assigning structured tasks to agents or groups.
// Writes task intent notes into the target agent's Symphony inbox.

import SwiftUI

struct TaskComposerView: View {
    @ObservedObject var groupStore: AgentGroupStore
    @ObservedObject var agentPartManager: AgentPartManager
    var taskStore: TaskStore?
    @Binding var isPresented: Bool

    /// Pre-selected target group (optional).
    var targetGroupId: UUID?

    @State private var scope = ""
    @State private var acceptance = ""
    @State private var priority: TaskPriority = .normal
    @State private var externalRef = ""
    @State private var selectedAgentId: String?
    @State private var selectedGroupId: UUID?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("New Task")
                .font(.headline)

            // Assign to
            HStack {
                Text("Assign to:")
                    .font(.caption.bold())

                Picker("", selection: $selectedGroupId) {
                    Text("Select group...").tag(nil as UUID?)
                    ForEach(groupStore.groups) { group in
                        Text(group.name).tag(group.id as UUID?)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: 180)

                if let groupId = selectedGroupId,
                   let group = groupStore.groups.first(where: { $0.id == groupId }) {
                    Picker("Agent:", selection: $selectedAgentId) {
                        Text("All in group").tag(nil as String?)
                        ForEach(group.agents) { agent in
                            Text(agent.symphonyAgentId).tag(agent.symphonyAgentId as String?)
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: 180)
                }
            }

            // Scope
            VStack(alignment: .leading, spacing: 2) {
                Text("Scope:")
                    .font(.caption.bold())
                TextEditor(text: $scope)
                    .font(.caption)
                    .frame(height: 80)
                    .border(Color.secondary.opacity(0.3), width: 1)
            }

            // Acceptance criteria
            VStack(alignment: .leading, spacing: 2) {
                Text("Acceptance criteria:")
                    .font(.caption.bold())
                TextEditor(text: $acceptance)
                    .font(.caption)
                    .frame(height: 60)
                    .border(Color.secondary.opacity(0.3), width: 1)
            }

            // Priority
            HStack {
                Text("Priority:")
                    .font(.caption.bold())
                Picker("", selection: $priority) {
                    Text("Low").tag(TaskPriority.low)
                    Text("Normal").tag(TaskPriority.normal)
                    Text("High").tag(TaskPriority.high)
                    Text("Critical").tag(TaskPriority.critical)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            // External reference
            HStack {
                Text("Ref:")
                    .font(.caption.bold())
                TextField("URL, ticket #, etc.", text: $externalRef)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
            }

            // Actions
            HStack {
                Spacer()
                Button("Cancel") { isPresented = false }
                    .keyboardShortcut(.cancelAction)
                Button("Assign Task") { assignTask() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(scope.isEmpty || acceptance.isEmpty)
            }
        }
        .padding()
        .frame(width: 480)
        .onAppear {
            if let targetGroupId { selectedGroupId = targetGroupId }
        }
    }

    // MARK: - Assign

    private func assignTask() {
        let taskId = "task-\(UUID().uuidString.prefix(12))"

        let taskPayload = TaskPayload(
            taskId: taskId,
            scope: scope,
            acceptance: acceptance,
            priority: priority,
            externalRef: externalRef.isEmpty ? nil : externalRef,
            assignedBy: "conductor/maestro"
        )

        let sender = Participant(
            id: "conductor/maestro",
            name: "Maestro",
            type: .human
        )

        let threadId = "thr-\(taskId)"

        // Determine target agents
        var targetAgentIds: [String] = []
        if let agentId = selectedAgentId {
            targetAgentIds = [agentId]
        } else if let groupId = selectedGroupId,
                  let group = groupStore.groups.first(where: { $0.id == groupId }) {
            targetAgentIds = group.agents.map(\.symphonyAgentId)
        }

        // Build the task note
        let note = SymphonyNote(
            id: "cond-task-\(UUID().uuidString.prefix(8))",
            threadRoot: threadId,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            sender: sender,
            recipients: targetAgentIds.map { id in
                Participant(id: id, name: id, type: .agent)
            },
            intent: .task,
            content: MessageContent(
                text: "**Task Assignment:** \(scope)\n\n**Acceptance:** \(acceptance)\n\n**Priority:** \(priority.rawValue)"
            ),
            symbols: [],
            metadata: MessageMetadata(task: taskPayload)
        )

        // Write to each target agent's inbox
        for agentId in targetAgentIds {
            ScoreIO.appendJsonl(note, to: ScoreIO.inboxPath(for: agentId))
        }

        // Track in task store
        taskStore?.addTask(payload: taskPayload, assignedTo: targetAgentIds)

        ConductorLog.flow("task-assign")
            .info("Assigned task \(taskId) to \(targetAgentIds.joined(separator: ", "))")

        isPresented = false
    }
}
