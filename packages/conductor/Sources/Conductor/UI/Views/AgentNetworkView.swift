// AgentNetworkView.swift — #agent-network-view
// Primary orchestration dashboard with group panels, agent status, thread access.
// Replaces/extends the workspace view as the primary collaboration view.

import SwiftUI

struct AgentNetworkView: View {
    @ObservedObject var groupStore: AgentGroupStore
    @ObservedObject var agentPartManager: AgentPartManager
    @ObservedObject var agentProcessManager: AgentProcessManager
    @ObservedObject var monitor: SymphonyMonitor
    @ObservedObject var relay: NoteRelay

    @State private var showNewGroup = false
    @State private var newGroupName = ""
    @State private var selectedThread: String?
    @State private var addAgentGroupId: UUID? = nil
    @State private var taskComposerGroupId: UUID? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Label("Agent Network", systemImage: "music.quarternote.3")
                    .font(.subheadline.bold())
                    .foregroundStyle(.secondary)
                Spacer()

                if monitor.totalUnreadCount > 0 {
                    Text("\(monitor.totalUnreadCount)")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(.red))
                }

                Button(action: { showNewGroup = true }) {
                    Image(systemName: "plus.circle")
                        .font(.subheadline)
                }
                .buttonStyle(.borderless)
                .help("New Group")
            }

            // Groups
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(groupStore.groups) { group in
                        groupPanel(group)
                    }

                    // Ungrouped agents
                    let ungrouped = groupStore.ungroupedAgents(from: agentPartManager.registeredAgents)
                    if !ungrouped.isEmpty {
                        ungroupedSection(ungrouped)
                    }
                }
            }
            .frame(maxHeight: 500)
        }
        .sheet(isPresented: $showNewGroup) {
            newGroupSheet
        }
        .sheet(item: $selectedThread) { threadId in
            ThreadView(
                threadId: threadId,
                monitor: monitor,
                relay: relay,
                agentPartManager: agentPartManager
            )
        }
    }

    // MARK: - Group Panel

    private func groupPanel(_ group: AgentGroup) -> some View {
        let groupColor = colorForName(group.color)
        let groupUnread = group.agents.reduce(0) { sum, agent in
            sum + (monitor.agentStatuses[agent.symphonyAgentId]?.unreadCount ?? 0)
        }

        return VStack(alignment: .leading, spacing: 4) {
            // Group header
            HStack(spacing: 6) {
                Circle()
                    .fill(groupColor)
                    .frame(width: 8, height: 8)

                Text(group.name)
                    .font(.caption.bold())

                Text("\(group.agents.count) agents")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                Spacer()

                if groupUnread > 0 {
                    Text("\(groupUnread) unread")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.orange)
                }

                // Group actions menu
                Menu {
                    Button("Send Task") {
                        taskComposerGroupId = group.id
                    }
                    Button("Add Agent") {
                        addAgentGroupId = group.id
                    }
                    Button("Stop All") {
                        stopGroupAgents(group)
                    }
                    Divider()
                    Menu("Color") {
                        ForEach(["blue", "purple", "orange", "green", "red", "cyan"], id: \.self) { color in
                            Button(color.capitalized) {
                                groupStore.setGroupColor(id: group.id, color: color)
                            }
                        }
                    }
                    Divider()
                    Button("Delete Group", role: .destructive) {
                        groupStore.deleteGroup(id: group.id)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
                .frame(width: 20)
            }

            // Agent rows
            ForEach(group.agents) { agent in
                agentRow(agent, groupId: group.id)
            }

            // Group thread access
            let threadIds = Set(group.agents.flatMap { agent in
                monitor.agentStatuses[agent.symphonyAgentId]?.activeThreadIds ?? []
            })
            if !threadIds.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: 9))
                        .foregroundStyle(.purple)
                    ForEach(Array(threadIds.prefix(3)), id: \.self) { threadId in
                        Button(action: { selectedThread = threadId }) {
                            Text(threadId.prefix(12) + "...")
                                .font(.system(size: 9))
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(groupColor.opacity(0.05))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(groupColor.opacity(0.2), lineWidth: 1)
                )
        )
        .sheet(isPresented: Binding(
            get: { addAgentGroupId == group.id },
            set: { if !$0 { addAgentGroupId = nil } }
        )) {
            addAgentSheet(groupId: group.id)
        }
        .sheet(isPresented: Binding(
            get: { taskComposerGroupId == group.id },
            set: { if !$0 { taskComposerGroupId = nil } }
        )) {
            TaskComposerView(
                groupStore: groupStore,
                agentPartManager: agentPartManager,
                isPresented: Binding(
                    get: { taskComposerGroupId == group.id },
                    set: { if !$0 { taskComposerGroupId = nil } }
                ),
                targetGroupId: group.id
            )
        }
    }

    // MARK: - Agent Row

    private func agentRow(_ agent: GroupedAgent, groupId: UUID) -> some View {
        let status = monitor.agentStatuses[agent.symphonyAgentId]
        let managedAgent = agentProcessManager.runningAgents.first { $0.id == agent.managedAgentId }
        let isRunning = managedAgent?.isAlive == true

        return HStack(spacing: 6) {
            Circle()
                .fill(isRunning ? Color.green : (status?.linked == true ? Color.yellow : Color.gray))
                .frame(width: 6, height: 6)

            VStack(alignment: .leading, spacing: 1) {
                Text("\(agent.agentRole) @ \(URL(fileURLWithPath: agent.projectPath).lastPathComponent)")
                    .font(.caption)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    if isRunning {
                        Text("running")
                            .font(.system(size: 8))
                            .foregroundStyle(.green)
                    } else if status?.linked == true {
                        Text("linked")
                            .font(.system(size: 8))
                            .foregroundStyle(.yellow)
                    } else {
                        Text("offline")
                            .font(.system(size: 8))
                            .foregroundStyle(.tertiary)
                    }

                    if let unread = status?.unreadCount, unread > 0 {
                        Text("\(unread) unread")
                            .font(.system(size: 8))
                            .foregroundStyle(.orange)
                    }
                }
            }

            Spacer()

            // Remove from group
            Button(action: {
                groupStore.removeAgent(groupId: groupId, agentId: agent.id)
            }) {
                Image(systemName: "minus.circle")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
        }
        .padding(.vertical, 2)
        .padding(.horizontal, 4)
    }

    // MARK: - Ungrouped

    private func ungroupedSection(_ agents: [AgentIdentity]) -> some View {
        DisclosureGroup {
            ForEach(agents) { agent in
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color.gray)
                        .frame(width: 6, height: 6)
                    Text(agent.id)
                        .font(.caption)
                        .lineLimit(1)
                    Spacer()

                    // Quick-add to group
                    if !groupStore.groups.isEmpty {
                        Menu {
                            ForEach(groupStore.groups) { group in
                                Button(group.name) {
                                    let grouped = GroupedAgent(
                                        id: UUID(),
                                        projectPath: resolveProjectPath(agent),
                                        agentRole: agent.role,
                                        symphonyAgentId: agent.id
                                    )
                                    groupStore.addAgent(groupId: group.id, agent: grouped)
                                }
                            }
                        } label: {
                            Image(systemName: "plus.circle")
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                        }
                        .menuStyle(.borderlessButton)
                        .frame(width: 20)
                    }
                }
                .padding(.vertical, 2)
            }
        } label: {
            HStack {
                Label("Ungrouped", systemImage: "person.crop.circle.badge.questionmark")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Text("\(agents.count)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    // MARK: - Sheets

    private var newGroupSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("New Group")
                .font(.headline)

            TextField("Group name", text: $newGroupName)
                .textFieldStyle(.roundedBorder)

            HStack {
                Spacer()
                Button("Cancel") {
                    newGroupName = ""
                    showNewGroup = false
                }
                .keyboardShortcut(.cancelAction)
                Button("Create") {
                    guard !newGroupName.isEmpty else { return }
                    groupStore.createGroup(name: newGroupName)
                    newGroupName = ""
                    showNewGroup = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(newGroupName.isEmpty)
            }
        }
        .padding()
        .frame(width: 300)
    }

    private func addAgentSheet(groupId: UUID) -> some View {
        let available = agentPartManager.registeredAgents.filter { agent in
            !groupStore.allGroupedAgents.contains { $0.symphonyAgentId == agent.id }
        }

        return VStack(alignment: .leading, spacing: 12) {
            Text("Add Agent to Group")
                .font(.headline)

            if available.isEmpty {
                Text("No ungrouped agents available")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else {
                ForEach(available) { agent in
                    Button(action: {
                        let grouped = GroupedAgent(
                            id: UUID(),
                            projectPath: resolveProjectPath(agent),
                            agentRole: agent.role,
                            symphonyAgentId: agent.id
                        )
                        groupStore.addAgent(groupId: groupId, agent: grouped)
                        addAgentGroupId = nil
                    }) {
                        HStack {
                            Text(agent.id)
                                .font(.caption)
                            Spacer()
                            Text(agent.role)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.bordered)
                }
            }

            HStack {
                Spacer()
                Button("Done") { addAgentGroupId = nil }
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding()
        .frame(width: 350)
    }

    // MARK: - Helpers

    private func colorForName(_ name: String) -> Color {
        switch name {
        case "blue": return .blue
        case "purple": return .purple
        case "orange": return .orange
        case "green": return .green
        case "red": return .red
        case "cyan": return .cyan
        case "yellow": return .yellow
        case "pink": return .pink
        default: return .blue
        }
    }

    private func stopGroupAgents(_ group: AgentGroup) {
        for agent in group.agents {
            if let managedId = agent.managedAgentId {
                agentProcessManager.stop(id: managedId)
            }
        }
    }

    private func resolveProjectPath(_ agent: AgentIdentity) -> String {
        // Agent ID format: "project-name/role" — resolve back to a path
        // For now, use the project field from identity
        agent.project
    }
}

// MARK: - String Identifiable conformance for sheet binding

extension String: @retroactive Identifiable {
    public var id: String { self }
}
