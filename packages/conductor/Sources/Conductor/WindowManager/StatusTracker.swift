// StatusTracker.swift — #status-tracker
// Polls Claude Code windows for idle/processing/finished status.
// Also monitors agent count from .paradigm/tasks/ files.

import Foundation

/// Tracks the operational status of Claude Code instances.
@MainActor
final class StatusTracker: ObservableObject {
    @Published private(set) var statuses: [String: InstanceStatus] = [:]
    @Published private(set) var agentCounts: [String: Int] = [:]

    private var pollTimer: Timer?
    private var previousOutputHashes: [String: Int] = [:]

    // MARK: - Polling

    func startTracking(detector: ClaudeCodeDetector, interval: TimeInterval = 3.0) {
        stopTracking()

        pollTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.updateStatuses(for: detector.instances)
            }
        }

        ConductorLog.component("status-tracker").info("Status tracking started")
    }

    func stopTracking() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    // MARK: - Status Detection

    private func updateStatuses(for instances: [ClaudeCodeInstance]) {
        for instance in instances {
            let newStatus = detectStatus(for: instance)
            let oldStatus = statuses[instance.id]

            if newStatus != oldStatus {
                statuses[instance.id] = newStatus
                ConductorLog.signal("status-changed")
                    .info("\(instance.title): \(oldStatus?.rawValue ?? "nil") → \(newStatus.rawValue)")
            }

            // Update agent count
            if let projectDir = instance.projectDirectory {
                let count = countActiveAgents(in: projectDir)
                let oldCount = agentCounts[instance.id]
                agentCounts[instance.id] = count

                if count != oldCount {
                    ConductorLog.signal("agent-count-changed")
                        .info("\(instance.title): \(count) agents")
                }
            }
        }

        // Clean up stale entries
        let activeIDs = Set(instances.map(\.id))
        for key in statuses.keys where !activeIDs.contains(key) {
            statuses.removeValue(forKey: key)
            agentCounts.removeValue(forKey: key)
        }
    }

    private func detectStatus(for instance: ClaudeCodeInstance) -> InstanceStatus {
        // Heuristic: check if the window title has changed (indicating activity)
        // A more robust approach would use AX to read terminal output, but that's
        // expensive and unreliable across terminal emulators.

        let titleHash = instance.title.hashValue
        let previousHash = previousOutputHashes[instance.id]
        previousOutputHashes[instance.id] = titleHash

        if previousHash == nil {
            return .unknown
        }

        if titleHash != previousHash {
            // Title changed — likely processing
            return .processing
        }

        // Title unchanged — could be idle or finished
        // Without more signals, default to idle
        return .idle
    }

    // MARK: - Agent Count

    /// Count active task files in .paradigm/tasks/ for a project.
    private nonisolated func countActiveAgents(in projectDir: String) -> Int {
        let tasksDir = (projectDir as NSString).appendingPathComponent(".paradigm/tasks")
        guard let files = try? FileManager.default.contentsOfDirectory(atPath: tasksDir) else {
            return 0
        }

        return files.filter { $0.hasSuffix(".yaml") || $0.hasSuffix(".yml") }.count
    }
}
