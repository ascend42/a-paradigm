// AgentHealthMonitorTests.swift
// Tests for #agent-health-monitor — health status, metrics, thresholds.

import XCTest
@testable import Conductor

@MainActor
final class AgentHealthMonitorTests: XCTestCase {

    private func makeMonitor() -> AgentHealthMonitor {
        AgentHealthMonitor()
    }

    private func makeTask(
        id: String,
        assignedTo: [String],
        status: TaskStatus,
        createdAt: Date = .now.addingTimeInterval(-60),
        completedAt: Date? = .now
    ) -> TaskRecord {
        TaskRecord(
            id: id,
            scope: "test",
            acceptance: "test",
            priority: .normal,
            assignedTo: assignedTo,
            status: status,
            progress: status == .complete ? 100 : 0,
            timeline: [],
            filesModified: [],
            symbolsTouched: [],
            blockers: [],
            createdAt: createdAt,
            completedAt: completedAt
        )
    }

    func testEmptyMetrics() {
        let monitor = makeMonitor()
        monitor.recompute(from: [])
        XCTAssertTrue(monitor.metrics.isEmpty)
        XCTAssertEqual(monitor.totalTasks, 0)
    }

    func testSingleCompleted() {
        let monitor = makeMonitor()
        monitor.recompute(from: [
            makeTask(id: "t1", assignedTo: ["agent/a"], status: .complete)
        ])

        XCTAssertEqual(monitor.metrics["agent/a"]?.tasksCompleted, 1)
        XCTAssertEqual(monitor.metrics["agent/a"]?.tasksFailed, 0)
        XCTAssertEqual(monitor.metrics["agent/a"]?.successRate, 1.0)
    }

    func testMixedOutcomes() {
        let monitor = makeMonitor()
        monitor.recompute(from: [
            makeTask(id: "t1", assignedTo: ["agent/a"], status: .complete),
            makeTask(id: "t2", assignedTo: ["agent/a"], status: .failed),
            makeTask(id: "t3", assignedTo: ["agent/a"], status: .complete),
        ])

        let m = monitor.metrics["agent/a"]!
        XCTAssertEqual(m.tasksCompleted, 2)
        XCTAssertEqual(m.tasksFailed, 1)
        XCTAssertEqual(m.successRate, 2.0 / 3.0, accuracy: 0.01)
    }

    func testHealthyThreshold() {
        let monitor = makeMonitor()
        // 9/10 = 90% → healthy
        var tasks: [TaskRecord] = []
        for i in 0..<9 {
            tasks.append(makeTask(id: "t\(i)", assignedTo: ["agent/a"], status: .complete))
        }
        tasks.append(makeTask(id: "t9", assignedTo: ["agent/a"], status: .failed))
        monitor.recompute(from: tasks)

        XCTAssertEqual(monitor.metrics["agent/a"]?.healthStatus, .healthy)
    }

    func testDegradedThreshold() {
        let monitor = makeMonitor()
        // 6/10 = 60% → degraded
        var tasks: [TaskRecord] = []
        for i in 0..<6 {
            tasks.append(makeTask(id: "t\(i)", assignedTo: ["agent/a"], status: .complete))
        }
        for i in 6..<10 {
            tasks.append(makeTask(id: "t\(i)", assignedTo: ["agent/a"], status: .failed))
        }
        monitor.recompute(from: tasks)

        XCTAssertEqual(monitor.metrics["agent/a"]?.healthStatus, .degraded)
    }

    func testUnhealthyThreshold() {
        let monitor = makeMonitor()
        // 3/10 = 30% → unhealthy
        var tasks: [TaskRecord] = []
        for i in 0..<3 {
            tasks.append(makeTask(id: "t\(i)", assignedTo: ["agent/a"], status: .complete))
        }
        for i in 3..<10 {
            tasks.append(makeTask(id: "t\(i)", assignedTo: ["agent/a"], status: .failed))
        }
        monitor.recompute(from: tasks)

        XCTAssertEqual(monitor.metrics["agent/a"]?.healthStatus, .unhealthy)
    }

    func testMultiAgentTask() {
        let monitor = makeMonitor()
        // Task assigned to 2 agents
        monitor.recompute(from: [
            makeTask(id: "t1", assignedTo: ["agent/a", "agent/b"], status: .complete)
        ])

        XCTAssertEqual(monitor.metrics["agent/a"]?.tasksCompleted, 1)
        XCTAssertEqual(monitor.metrics["agent/b"]?.tasksCompleted, 1)
    }

    func testRecentOutcomesCap() {
        let monitor = makeMonitor()
        // 15 tasks — recentOutcomes should cap at 10
        var tasks: [TaskRecord] = []
        for i in 0..<15 {
            tasks.append(makeTask(id: "t\(i)", assignedTo: ["agent/a"], status: .complete))
        }
        monitor.recompute(from: tasks)

        XCTAssertEqual(monitor.metrics["agent/a"]?.recentOutcomes.count, 10)
    }

    func testBestPerformer() {
        let monitor = makeMonitor()
        monitor.recompute(from: [
            makeTask(id: "t1", assignedTo: ["agent/a"], status: .complete),
            makeTask(id: "t2", assignedTo: ["agent/a"], status: .failed),
            makeTask(id: "t3", assignedTo: ["agent/b"], status: .complete),
            makeTask(id: "t4", assignedTo: ["agent/b"], status: .complete),
        ])

        XCTAssertEqual(monitor.bestPerformer, "agent/b") // 100% vs 50%
    }

    func testAvgTime() {
        let monitor = makeMonitor()
        let now = Date.now
        monitor.recompute(from: [
            makeTask(id: "t1", assignedTo: ["agent/a"], status: .complete,
                     createdAt: now.addingTimeInterval(-60), completedAt: now),
        ])

        // Should be ~60,000 ms
        XCTAssertEqual(monitor.metrics["agent/a"]?.avgCompletionTimeMs ?? 0, 60_000, accuracy: 1000)
    }

    func testUnknownStatus() {
        let monitor = makeMonitor()
        // In-progress tasks don't count toward metrics
        monitor.recompute(from: [
            makeTask(id: "t1", assignedTo: ["agent/a"], status: .inProgress, completedAt: nil)
        ])

        XCTAssertTrue(monitor.metrics.isEmpty)
    }
}
