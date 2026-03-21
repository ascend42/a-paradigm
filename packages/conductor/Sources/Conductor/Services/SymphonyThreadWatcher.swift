// SymphonyThreadWatcher.swift — #symphony-thread-watcher
// Lightweight watcher that polls mailbox JSONL for orchestration team threads.
// Filters for threads matching "thr-orch-" prefix (Maestro orchestration threads).

import Foundation

/// Watches for Maestro team orchestration threads in Symphony mailboxes.
@MainActor
final class SymphonyThreadWatcher: ObservableObject {

    /// Active team threads keyed by threadRoot, with messages sorted chronologically.
    @Published var teamThreads: [String: [SymphonyNote]] = [:]

    /// Agent attributions extracted from messages: agentRole → latest attribution prefix.
    @Published var agentAttributions: [String: String] = [:]

    private var pollTask: Task<Void, Never>?
    private var watchedPaths: [URL] = []
    private var processedIds: Set<String> = []

    // MARK: - Start/Stop

    /// Start watching the given agent mailbox paths for team threads.
    func startWatching(agentIds: [String], interval: TimeInterval = 3.0) {
        watchedPaths = agentIds.flatMap { agentId in
            [ScoreIO.inboxPath(for: agentId), ScoreIO.outboxPath(for: agentId)]
        }
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                self?.pollMailboxes()
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            }
        }
    }

    func stopWatching() {
        pollTask?.cancel()
        pollTask = nil
        watchedPaths.removeAll()
    }

    // MARK: - Poll

    private func pollMailboxes() {
        for path in watchedPaths {
            let notes: [SymphonyNote] = ScoreIO.readJsonl(at: path)
            for note in notes {
                guard !processedIds.contains(note.id) else { continue }
                processedIds.insert(note.id)

                // Only track orchestration team threads (thr-orch-*)
                guard let threadRoot = note.threadRoot,
                      threadRoot.hasPrefix("thr-orch-") else { continue }

                var messages = teamThreads[threadRoot] ?? []
                if !messages.contains(where: { $0.id == note.id }) {
                    messages.append(note)
                    messages.sort { $0.timestamp < $1.timestamp }
                    teamThreads[threadRoot] = messages
                }

                // Extract attribution from message content (e.g., "[architect] ...")
                let text = note.content.text
                if text.hasPrefix("["),
                   let closeBracket = text.firstIndex(of: "]") {
                    let attribution = String(text[text.startIndex...closeBracket])
                    let role = note.sender.role ?? note.sender.name
                    agentAttributions[role] = attribution
                }
            }
        }
    }

    // MARK: - Queries

    /// All active team thread IDs sorted by most recent activity.
    var activeThreadIds: [String] {
        teamThreads
            .sorted { ($0.value.last?.timestamp ?? "") > ($1.value.last?.timestamp ?? "") }
            .map(\.key)
    }

    /// Total message count across all team threads.
    var totalMessageCount: Int {
        teamThreads.values.reduce(0) { $0 + $1.count }
    }

    /// Get a display-friendly thread name from the orchestration ID.
    func threadDisplayName(_ threadId: String) -> String {
        // thr-orch-m1abc-xy3z → "Team m1abc"
        let stripped = threadId
            .replacingOccurrences(of: "thr-orch-", with: "")
        let parts = stripped.split(separator: "-")
        if let first = parts.first {
            return "Team \(first)"
        }
        return threadId
    }
}
