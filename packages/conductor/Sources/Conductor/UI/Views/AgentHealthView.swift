// AgentHealthView.swift — #agent-health-view
// Aggregate and per-agent health metrics dashboard.

import SwiftUI

struct AgentHealthView: View {
    @ObservedObject var healthMonitor: AgentHealthMonitor

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            Label("Agent Health", systemImage: "heart.text.square")
                .font(.subheadline.bold())
                .foregroundStyle(.secondary)

            // Aggregate
            if healthMonitor.totalTasks > 0 {
                HStack(spacing: 12) {
                    statBox("Tasks", value: "\(healthMonitor.totalTasks)")
                    statBox("Success", value: "\(Int(healthMonitor.overallSuccessRate * 100))%")
                    if let best = healthMonitor.bestPerformer {
                        statBox("Best", value: best.components(separatedBy: "/").last ?? best)
                    }
                }
            }

            // Per-agent cards
            ForEach(Array(healthMonitor.metrics.keys.sorted()), id: \.self) { agentId in
                if let m = healthMonitor.metrics[agentId] {
                    agentCard(agentId: agentId, metrics: m)
                }
            }

            if healthMonitor.metrics.isEmpty {
                Text("No completed tasks yet")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    // MARK: - Subviews

    private func statBox(_ label: String, value: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
            Text(label)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 6).fill(.quaternary))
    }

    private func agentCard(agentId: String, metrics: AgentMetrics) -> some View {
        HStack(spacing: 8) {
            // Health dot
            Circle()
                .fill(healthColor(metrics.healthStatus))
                .frame(width: 8, height: 8)

            // Agent ID
            VStack(alignment: .leading, spacing: 1) {
                Text(agentId.components(separatedBy: "/").last ?? agentId)
                    .font(.caption.bold())
                    .lineLimit(1)

                HStack(spacing: 6) {
                    Text("\(metrics.tasksCompleted + metrics.tasksFailed) tasks")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)

                    if metrics.avgCompletionTimeMs > 0 {
                        Text(formatDuration(metrics.avgCompletionTimeMs))
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            Spacer()

            // Success rate circle
            ZStack {
                Circle()
                    .stroke(.quaternary, lineWidth: 2)
                    .frame(width: 24, height: 24)
                Circle()
                    .trim(from: 0, to: metrics.successRate)
                    .stroke(healthColor(metrics.healthStatus), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .frame(width: 24, height: 24)
                    .rotationEffect(.degrees(-90))
                Text("\(Int(metrics.successRate * 100))")
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
            }

            // Sparkline (recent outcomes)
            if !metrics.recentOutcomes.isEmpty {
                HStack(spacing: 1) {
                    ForEach(Array(metrics.recentOutcomes.enumerated()), id: \.offset) { _, success in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(success ? Color.green : Color.red)
                            .frame(width: 3, height: success ? 12 : 6)
                    }
                }
            }
        }
        .padding(6)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(.background)
                .shadow(color: .black.opacity(0.03), radius: 1, y: 1)
        )
    }

    // MARK: - Helpers

    private func healthColor(_ status: HealthStatus) -> Color {
        switch status {
        case .healthy: return .green
        case .degraded: return .yellow
        case .unhealthy: return .red
        case .unknown: return .gray
        }
    }

    private func formatDuration(_ ms: Double) -> String {
        if ms < 60_000 {
            return "\(Int(ms / 1000))s avg"
        } else if ms < 3_600_000 {
            return "\(Int(ms / 60_000))m avg"
        } else {
            return "\(Int(ms / 3_600_000))h avg"
        }
    }
}
