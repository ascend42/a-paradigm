// SymphonyMonitor.swift — #symphony-monitor
// Polls Symphony status for agents in groups: unread counts, last activity, threads.

import Foundation

/// Per-agent Symphony status snapshot.
struct SymphonyAgentStatus {
    var linked: Bool
    var unreadCount: Int
    var lastActivity: Date?
    var activeThreadIds: [String]
}

/// Monitors Symphony inboxes/outboxes for agents in groups.
@MainActor
final class SymphonyMonitor: ObservableObject {

    /// Status keyed by symphonyAgentId.
    @Published var agentStatuses: [String: SymphonyAgentStatus] = [:]

    /// All thread messages loaded from inboxes, keyed by threadRoot.
    @Published var threadMessages: [String: [SymphonyNote]] = [:]

    private var pollTask: Task<Void, Never>?
    private var monitoredAgentIds: Set<String> = []

    // MARK: - Start/Stop

    /// Start polling the given agents at the specified interval.
    func startPolling(agents: [GroupedAgent], interval: TimeInterval = 5.0) {
        monitoredAgentIds = Set(agents.map(\.symphonyAgentId))
        pollTask?.cancel()

        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                self?.pollCycle()
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            }
        }
    }

    /// Update the set of monitored agents without restarting the loop.
    func updateAgents(_ agents: [GroupedAgent]) {
        monitoredAgentIds = Set(agents.map(\.symphonyAgentId))
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
        monitoredAgentIds.removeAll()
    }

    // MARK: - Poll Cycle

    private func pollCycle() {
        let fm = FileManager.default

        for agentId in monitoredAgentIds {
            let agentDir = ScoreIO.agentDir(for: agentId)
            let identityPath = ScoreIO.identityPath(for: agentId)
            let inboxPath = ScoreIO.inboxPath(for: agentId)
            let ackPath = ScoreIO.ackPath(for: agentId)

            let linked = fm.fileExists(atPath: identityPath.path)

            // Read inbox
            let inboxNotes: [SymphonyNote] = ScoreIO.readJsonl(at: inboxPath)

            // Read ack to determine unread count
            let ack: AckRecord? = ScoreIO.readJson(at: ackPath)
            let unreadCount: Int
            if let lastAck = ack?.lastAck {
                unreadCount = inboxNotes.filter { $0.timestamp > lastAck }.count
            } else {
                unreadCount = inboxNotes.count
            }

            // Last activity
            let lastActivity: Date?
            if let lastNote = inboxNotes.last {
                let formatter = ISO8601DateFormatter()
                lastActivity = formatter.date(from: lastNote.timestamp)
            } else {
                lastActivity = nil
            }

            // Active thread IDs from inbox
            let threadIds = Set(inboxNotes.compactMap(\.threadRoot))

            agentStatuses[agentId] = SymphonyAgentStatus(
                linked: linked,
                unreadCount: unreadCount,
                lastActivity: lastActivity,
                activeThreadIds: Array(threadIds)
            )

            // Index messages by thread
            for note in inboxNotes {
                if let threadRoot = note.threadRoot {
                    var messages = threadMessages[threadRoot] ?? []
                    if !messages.contains(where: { $0.id == note.id }) {
                        messages.append(note)
                        messages.sort { $0.timestamp < $1.timestamp }
                        threadMessages[threadRoot] = messages
                    }
                }
            }

            // Also read outbox for complete thread picture
            let outboxPath = ScoreIO.outboxPath(for: agentId)
            let outboxNotes: [SymphonyNote] = ScoreIO.readJsonl(at: outboxPath)
            for note in outboxNotes {
                if let threadRoot = note.threadRoot {
                    var messages = threadMessages[threadRoot] ?? []
                    if !messages.contains(where: { $0.id == note.id }) {
                        messages.append(note)
                        messages.sort { $0.timestamp < $1.timestamp }
                        threadMessages[threadRoot] = messages
                    }
                }
            }
        }
    }

    // MARK: - Queries

    /// Total unread count across all monitored agents.
    var totalUnreadCount: Int {
        agentStatuses.values.reduce(0) { $0 + $1.unreadCount }
    }

    /// Get thread messages for a specific thread.
    func getThread(threadId: String) -> [SymphonyNote] {
        threadMessages[threadId] ?? []
    }

    /// All unique thread IDs across monitored agents.
    var allThreadIds: [String] {
        Array(Set(agentStatuses.values.flatMap(\.activeThreadIds)))
    }
}
