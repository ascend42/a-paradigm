// AgentHealthMonitor.swift — #agent-health-monitor
// Computes per-agent health metrics from task completion history.

import Foundation
import Combine

// MARK: - Health Status

enum HealthStatus: String, Sendable {
    case healthy     // >80% success
    case degraded    // 50–80% success
    case unhealthy   // <50% success
    case unknown     // no data

    static func from(successRate: Double) -> HealthStatus {
        if successRate > 0.8 { return .healthy }
        if successRate >= 0.5 { return .degraded }
        return .unhealthy
    }
}

// MARK: - Agent Metrics

struct AgentMetrics: Sendable {
    var tasksCompleted: Int = 0
    var tasksFailed: Int = 0
    var successRate: Double = 0
    var avgCompletionTimeMs: Double = 0
    var lastTaskAt: Date? = nil
    var recentOutcomes: [Bool] = []  // last 10, true = success

    var healthStatus: HealthStatus {
        let total = tasksCompleted + tasksFailed
        if total == 0 { return .unknown }
        return HealthStatus.from(successRate: successRate)
    }
}

// MARK: - Agent Health Monitor

/// Computes agent health metrics from TaskStore task records.
@MainActor
final class AgentHealthMonitor: ObservableObject {

    @Published private(set) var metrics: [String: AgentMetrics] = [:]

    private var cancellable: AnyCancellable?

    /// Wire to a TaskStore to auto-recompute on task changes.
    func configure(taskStore: TaskStore) {
        cancellable = taskStore.$tasks
            .receive(on: DispatchQueue.main)
            .sink { [weak self] tasks in
                self?.recompute(from: tasks)
            }
    }

    /// Recompute all metrics from the current task list.
    func recompute(from tasks: [TaskRecord]) {
        var newMetrics: [String: AgentMetrics] = [:]

        for task in tasks {
            guard task.status == .complete || task.status == .failed else { continue }

            for agentId in task.assignedTo {
                var m = newMetrics[agentId] ?? AgentMetrics()

                let success = task.status == .complete
                if success {
                    m.tasksCompleted += 1
                } else {
                    m.tasksFailed += 1
                }

                // Compute completion time
                if let completedAt = task.completedAt {
                    let duration = completedAt.timeIntervalSince(task.createdAt) * 1000
                    let totalDone = m.tasksCompleted + m.tasksFailed
                    // Running average
                    m.avgCompletionTimeMs = ((m.avgCompletionTimeMs * Double(totalDone - 1)) + duration) / Double(totalDone)
                }

                // Track last task time
                if let completedAt = task.completedAt {
                    if m.lastTaskAt == nil || completedAt > m.lastTaskAt! {
                        m.lastTaskAt = completedAt
                    }
                }

                // Recent outcomes (capped at 10)
                m.recentOutcomes.append(success)
                if m.recentOutcomes.count > 10 {
                    m.recentOutcomes.removeFirst()
                }

                // Recompute success rate
                let total = m.tasksCompleted + m.tasksFailed
                m.successRate = total > 0 ? Double(m.tasksCompleted) / Double(total) : 0

                newMetrics[agentId] = m
            }
        }

        metrics = newMetrics
    }

    // MARK: - Computed

    /// Overall success rate across all agents.
    var overallSuccessRate: Double {
        let totals = metrics.values.reduce((0, 0)) { ($0.0 + $1.tasksCompleted, $0.1 + $1.tasksFailed) }
        let total = totals.0 + totals.1
        return total > 0 ? Double(totals.0) / Double(total) : 0
    }

    /// Agent ID with best success rate (min 1 task).
    var bestPerformer: String? {
        metrics
            .filter { ($0.value.tasksCompleted + $0.value.tasksFailed) > 0 }
            .max { $0.value.successRate < $1.value.successRate }?
            .key
    }

    /// Total tasks across all agents.
    var totalTasks: Int {
        metrics.values.reduce(0) { $0 + $1.tasksCompleted + $1.tasksFailed }
    }
}
