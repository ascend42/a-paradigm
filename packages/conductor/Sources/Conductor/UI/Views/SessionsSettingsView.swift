// SessionsSettingsView.swift — #sessions-settings
// Settings tab for session/agent configuration.

import SwiftUI

struct SessionsSettingsView: View {
    @ObservedObject var projectStore: ProjectStore
    @ObservedObject var agentProcessManager: AgentProcessManager

    @AppStorage("autoLaunchOnOpen") private var autoLaunchOnOpen: Bool = false
    @AppStorage("defaultAgentRole") private var defaultAgentRole: String = "agent"

    var body: some View {
        Form {
            Section("Agent Defaults") {
                Picker("Default role", selection: $defaultAgentRole) {
                    Text("Agent").tag("agent")
                    Text("Architect").tag("architect")
                    Text("Builder").tag("builder")
                    Text("Reviewer").tag("reviewer")
                    Text("Tester").tag("tester")
                }

                Toggle("Auto-launch agent when opening a project", isOn: $autoLaunchOnOpen)
            }

            Section("Recent Projects") {
                Text("\(projectStore.projects.count) projects remembered")
                    .foregroundStyle(.secondary)

                if !projectStore.projects.isEmpty {
                    Button("Clear All Recent Projects", role: .destructive) {
                        for project in projectStore.projects {
                            projectStore.remove(id: project.id)
                        }
                    }
                }
            }

            Section("Running Agents") {
                Text("\(agentProcessManager.runningAgents.filter(\.isAlive).count) active")
                    .foregroundStyle(.secondary)

                if !agentProcessManager.runningAgents.isEmpty {
                    Button("Stop All Agents", role: .destructive) {
                        agentProcessManager.stopAll()
                    }

                    Button("Clean Up Stopped") {
                        agentProcessManager.pruneStoppedAgents()
                    }
                }
            }
        }
    }
}
