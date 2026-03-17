// SessionManagerView.swift — #session-manager-view
// Dashboard: recent projects with checkpoint status + running headless agents.
// Actions: continue, discard, launch, view log, pin.

import SwiftUI

struct SessionManagerView: View {
    @ObservedObject var projectStore: ProjectStore
    @ObservedObject var agentManager: AgentProcessManager
    let onLaunchInTerminal: (String) -> Void

    @State private var selectedLogAgent: UUID?
    @State private var showLaunchSheet = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Section header
            HStack {
                Label("Sessions", systemImage: "bolt.fill")
                    .font(.subheadline.bold())
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: { showLaunchSheet = true }) {
                    Image(systemName: "plus.circle")
                        .font(.subheadline)
                }
                .buttonStyle(.borderless)
                .help("Launch new agent")
            }

            // Recent projects
            if projectStore.sorted.isEmpty && agentManager.runningAgents.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(spacing: 6) {
                        // Project cards
                        ForEach(projectStore.sorted) { project in
                            projectCard(project)
                        }

                        // Running agents section
                        if !agentManager.runningAgents.isEmpty {
                            runningAgentsSection
                        }
                    }
                }
                .frame(maxHeight: 400)
            }
        }
        .sheet(isPresented: $showLaunchSheet) {
            LaunchAgentSheet(
                projectStore: projectStore,
                agentManager: agentManager,
                isPresented: $showLaunchSheet
            )
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "bolt.circle")
                .font(.title2)
                .foregroundStyle(.tertiary)
            Text("No recent projects")
                .font(.caption)
                .foregroundStyle(.tertiary)
            Text("Launch an agent or open a project")
                .font(.caption2)
                .foregroundStyle(.quaternary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    // MARK: - Project Card

    private func projectCard(_ project: RecentProject) -> some View {
        let checkpoint = CheckpointReader.readCheckpoint(projectPath: project.path)
        let hasAgent = agentManager.runningAgents.contains { $0.projectPath == project.path }

        return VStack(alignment: .leading, spacing: 4) {
            // Header row
            HStack(spacing: 6) {
                Image(systemName: "folder.fill")
                    .foregroundStyle(.cyan)
                    .font(.caption)

                Text(project.name)
                    .font(.caption.bold())
                    .lineLimit(1)

                if project.pinned {
                    Image(systemName: "star.fill")
                        .foregroundStyle(.yellow)
                        .font(.system(size: 8))
                }

                Spacer()

                // Status badge
                if hasAgent {
                    statusBadge("Running", color: .green)
                } else if checkpoint != nil {
                    statusBadge(checkpoint!.phase.capitalized, color: phaseColor(checkpoint!.phase))
                }
            }

            // Checkpoint info
            if let checkpoint {
                Text(checkpoint.context)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    if let files = checkpoint.modifiedFiles {
                        Label("\(files.count) files", systemImage: "doc")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    Text(checkpoint.ageString)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            // Action buttons
            HStack(spacing: 6) {
                if checkpoint != nil && !hasAgent {
                    Button("Continue") {
                        launchAgent(projectPath: project.path, role: project.lastAgentRole, resume: true)
                    }
                    .controlSize(.mini)
                    .buttonStyle(.borderedProminent)

                    Button("Discard") {
                        discardCheckpoint(projectPath: project.path)
                    }
                    .controlSize(.mini)
                    .buttonStyle(.bordered)
                } else if !hasAgent {
                    Button("Launch") {
                        launchAgent(projectPath: project.path, role: project.lastAgentRole, resume: false)
                    }
                    .controlSize(.mini)
                    .buttonStyle(.bordered)
                }

                Button("Terminal") {
                    onLaunchInTerminal(project.path)
                }
                .controlSize(.mini)
                .buttonStyle(.bordered)

                Spacer()

                // Context menu for pin/remove
                Menu {
                    Button(project.pinned ? "Unpin" : "Pin") {
                        projectStore.togglePin(id: project.id)
                    }
                    Button("Remove", role: .destructive) {
                        projectStore.remove(id: project.id)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
                .frame(width: 20)
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
    }

    // MARK: - Running Agents Section

    private var runningAgentsSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Label("Running Agents", systemImage: "cpu")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Stop All") {
                    agentManager.stopAll()
                }
                .controlSize(.mini)
                .buttonStyle(.bordered)
                .tint(.red)
            }
            .padding(.top, 4)

            ForEach(agentManager.runningAgents) { agent in
                agentRow(agent)
            }
        }
    }

    private func agentRow(_ agent: ManagedAgent) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Circle()
                    .fill(agent.isAlive ? Color.green : Color.red)
                    .frame(width: 6, height: 6)

                Text("\(agent.agentRole) @ \(URL(fileURLWithPath: agent.projectPath).lastPathComponent)")
                    .font(.caption.bold())
                    .lineLimit(1)

                Spacer()

                Text("PID \(agent.process.processIdentifier)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                Text(ageDuration(from: agent.startedAt))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            // Last output line
            if let lastLine = agent.lastOutputLines.last {
                Text(lastLine)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            // Controls
            HStack(spacing: 6) {
                Button(selectedLogAgent == agent.id ? "Hide Log" : "View Log") {
                    if selectedLogAgent == agent.id {
                        selectedLogAgent = nil
                    } else {
                        selectedLogAgent = agent.id
                    }
                }
                .controlSize(.mini)
                .buttonStyle(.bordered)

                Button("Stop") {
                    agentManager.stop(id: agent.id)
                }
                .controlSize(.mini)
                .buttonStyle(.bordered)
                .tint(.red)

                Spacer()
            }

            // Log viewer
            if selectedLogAgent == agent.id {
                logViewer(for: agent)
            }
        }
        .padding(6)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
    }

    private func logViewer(for agent: ManagedAgent) -> some View {
        let lines = agentManager.getOutput(id: agent.id, lines: 50)
        return ScrollView {
            VStack(alignment: .leading, spacing: 1) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.primary)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 200)
        .padding(6)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.black.opacity(0.8))
        )
    }

    // MARK: - Helpers

    private func statusBadge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(color)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(
                Capsule().fill(color.opacity(0.15))
            )
    }

    private func phaseColor(_ phase: String) -> Color {
        switch phase {
        case "planning": return .blue
        case "implementing": return .orange
        case "validating": return .purple
        case "complete": return .green
        default: return .gray
        }
    }

    private func ageDuration(from date: Date) -> String {
        let seconds = Int(Date.now.timeIntervalSince(date))
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h\(minutes % 60)m"
    }

    private func launchAgent(projectPath: String, role: String?, resume: Bool) {
        let agentRole = role ?? "agent"
        projectStore.addOrUpdate(
            path: projectPath,
            name: CheckpointReader.projectName(for: projectPath),
            role: agentRole
        )

        do {
            var prompt: String? = nil
            if resume {
                if let checkpoint = CheckpointReader.readCheckpoint(projectPath: projectPath) {
                    prompt = "Continue from previous session. Phase: \(checkpoint.phase). Context: \(checkpoint.context)"
                    if let plan = checkpoint.plan {
                        prompt! += "\nPlan: \(plan)"
                    }
                }
            }
            try agentManager.spawn(
                projectPath: projectPath,
                role: agentRole,
                initialPrompt: prompt
            )
        } catch {
            ConductorLog.component("session-manager")
                .error("Failed to spawn agent: \(error.localizedDescription)")
        }
    }

    private func discardCheckpoint(projectPath: String) {
        // Remove local checkpoint file
        let localPath = URL(fileURLWithPath: projectPath)
            .appendingPathComponent(".paradigm/session-checkpoint.json")
        try? FileManager.default.removeItem(at: localPath)
    }
}

// MARK: - Launch Agent Sheet

struct LaunchAgentSheet: View {
    @ObservedObject var projectStore: ProjectStore
    @ObservedObject var agentManager: AgentProcessManager
    @Binding var isPresented: Bool

    @State private var projectPath = ""
    @State private var agentRole = "agent"

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Launch Agent")
                .font(.headline)

            TextField("Project path", text: $projectPath)
                .textFieldStyle(.roundedBorder)

            HStack {
                Text("Role:")
                Picker("", selection: $agentRole) {
                    Text("Agent").tag("agent")
                    Text("Architect").tag("architect")
                    Text("Builder").tag("builder")
                    Text("Reviewer").tag("reviewer")
                    Text("Tester").tag("tester")
                }
                .labelsHidden()
                .pickerStyle(.segmented)
            }

            // Quick-launch from recent projects
            if !projectStore.sorted.isEmpty {
                Text("Recent:")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                ForEach(projectStore.sorted.prefix(5)) { project in
                    Button(action: {
                        projectPath = project.path
                    }) {
                        Text(project.name)
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }

            HStack {
                Spacer()
                Button("Cancel") { isPresented = false }
                    .keyboardShortcut(.cancelAction)
                Button("Launch") {
                    guard !projectPath.isEmpty else { return }
                    projectStore.addOrUpdate(
                        path: projectPath,
                        name: CheckpointReader.projectName(for: projectPath),
                        role: agentRole
                    )
                    _ = try? agentManager.spawn(
                        projectPath: projectPath,
                        role: agentRole
                    )
                    isPresented = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(projectPath.isEmpty)
            }
        }
        .padding()
        .frame(width: 400)
    }
}
