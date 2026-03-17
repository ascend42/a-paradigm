// StatusBarView.swift — #status-bar
// Bottom status bar for the workspace container with section links.

import SwiftUI

struct StatusBarView: View {
    @ObservedObject var taskStore: TaskStore
    @ObservedObject var sentinelClient: SentinelWSClient
    @ObservedObject var agentHealthMonitor: AgentHealthMonitor
    let onSelectTab: (ControlPanelTab) -> Void

    var body: some View {
        HStack(spacing: 0) {
            // Tasks section
            statusSection(
                icon: "checklist",
                text: taskText,
                color: taskStore.blockedTasks.isEmpty ? .secondary : .red
            ) {
                onSelectTab(.orchestrate)
            }

            statusDivider

            // Sentinel section
            statusSection(
                icon: "antenna.radiowaves.left.and.right",
                text: sentinelText,
                color: sentinelClient.isConnected ? .secondary : .red,
                dot: sentinelClient.isConnected ? .green : .red
            ) {
                onSelectTab(.monitor)
            }

            statusDivider

            // Health section
            statusSection(
                icon: "heart.fill",
                text: healthText,
                color: .secondary
            ) {
                onSelectTab(.monitor)
            }

            Spacer()

            // Keyboard hints
            Text("⌘\\ panel  ⌘1-6 presets")
                .font(.system(size: 8))
                .foregroundStyle(.quaternary)
                .padding(.trailing, 8)
        }
        .padding(.horizontal, 8)
        .background(.ultraThinMaterial)
    }

    // MARK: - Text Computations

    private var taskText: String {
        let active = taskStore.activeTasks.count
        let blocked = taskStore.blockedTasks.count
        if active == 0 { return "No tasks" }
        if blocked > 0 { return "\(active) active, \(blocked) blocked" }
        return "\(active) active"
    }

    private var sentinelText: String {
        let count = sentinelClient.recentEvents.count
        if !sentinelClient.isConnected { return "Disconnected" }
        return "\(count) event\(count == 1 ? "" : "s")"
    }

    private var healthText: String {
        let count = agentHealthMonitor.metrics.count
        if count == 0 { return "No agents" }
        return "\(count) agent\(count == 1 ? "" : "s")"
    }

    // MARK: - Subviews

    private func statusSection(
        icon: String,
        text: String,
        color: Color,
        dot: Color? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let dot {
                    Circle()
                        .fill(dot)
                        .frame(width: 5, height: 5)
                } else {
                    Image(systemName: icon)
                        .font(.system(size: 8))
                }
                Text(text)
                    .font(.system(size: 9))
            }
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var statusDivider: some View {
        Divider()
            .frame(height: 12)
    }
}
