// SymphonyThreadWatcher.swift — #symphony-thread-watcher
// Watches mailbox JSONL for ALL Symphony threads across all projects.
// Shows threads with activity in the last 2 hours by default.

import Foundation

/// Watches for Symphony threads in agent mailboxes across all projects.
@MainActor
final class SymphonyThreadWatcher: ObservableObject {

    /// Active team threads keyed by threadRoot, with messages sorted chronologically.
    @Published var teamThreads: [String: [SymphonyNote]] = [:]

    /// Agent attributions extracted from messages: agentRole → latest attribution prefix.
    @Published var agentAttributions: [String: String] = [:]

    /// Show all threads vs only recent (default: recent only — last 2 hours)
    @Published var showAllThreads: Bool = false

    /// Notification manager — receives new notes for notification display.
    var notificationManager: SymphonyNotificationManager?

    private var pollTask: Task<Void, Never>?
    private var watchedPaths: [URL] = []
    private var processedIds: Set<String> = []

    /// Staleness cutoff: threads with no activity older than this are hidden by default.
    private let stalenessCutoff: TimeInterval = 2 * 60 * 60  // 2 hours

    // MARK: - Start/Stop

    /// Start watching the given agent mailbox paths for threads.
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

    /// Re-scan for new agents (call when Team Thread view opens).
    func rescanAgents() {
        let globalAgentIds = Self.discoverAllAgentIds()
        let newPaths = globalAgentIds.flatMap { agentId in
            [ScoreIO.inboxPath(for: agentId), ScoreIO.outboxPath(for: agentId)]
        }
        // Merge new paths without losing existing ones
        let existingSet = Set(watchedPaths.map(\.path))
        for path in newPaths where !existingSet.contains(path.path) {
            watchedPaths.append(path)
        }
    }

    func stopWatching() {
        pollTask?.cancel()
        pollTask = nil
        watchedPaths.removeAll()
    }

    // MARK: - Global Agent Discovery

    /// Discover ALL agent IDs across all projects in ~/.paradigm/score/agents/.
    static func discoverAllAgentIds() -> [String] {
        let fm = FileManager.default
        let agentsDir = ScoreIO.agentsDir

        guard fm.fileExists(atPath: agentsDir.path) else { return [] }

        var agentIds: [String] = []
        do {
            let projects = try fm.contentsOfDirectory(at: agentsDir, includingPropertiesForKeys: nil)
            for projectDir in projects where projectDir.hasDirectoryPath {
                let projectName = projectDir.lastPathComponent
                let roles = try fm.contentsOfDirectory(at: projectDir, includingPropertiesForKeys: nil)
                for roleDir in roles where roleDir.hasDirectoryPath {
                    let role = roleDir.lastPathComponent
                    agentIds.append("\(projectName)/\(role)")
                }
            }
        } catch {
            // Score directory scan is best-effort
        }
        return agentIds
    }

    // MARK: - Poll

    private func pollMailboxes() {
        var newNotes: [SymphonyNote] = []

        for path in watchedPaths {
            let notes: [SymphonyNote] = ScoreIO.readJsonl(at: path)
            for note in notes {
                guard !processedIds.contains(note.id) else { continue }
                processedIds.insert(note.id)
                newNotes.append(note)

                // Accept ALL threads (no prefix filter)
                guard let threadRoot = note.threadRoot else { continue }

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

        // Dispatch new notes to notification manager
        if !newNotes.isEmpty {
            notificationManager?.processNotes(newNotes)
        }
    }

    // MARK: - Queries

    /// All active team thread IDs sorted by most recent activity.
    /// Filters to recent threads unless showAllThreads is true.
    var activeThreadIds: [String] {
        let now = Date()
        return teamThreads
            .filter { threadId, messages in
                if showAllThreads { return true }
                guard let lastMessage = messages.last else { return false }
                // Parse ISO timestamp and check staleness
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                guard let date = formatter.date(from: lastMessage.timestamp) else {
                    // Fallback: try without fractional seconds
                    formatter.formatOptions = [.withInternetDateTime]
                    guard let date = formatter.date(from: lastMessage.timestamp) else { return true }
                    return now.timeIntervalSince(date) < stalenessCutoff
                }
                return now.timeIntervalSince(date) < stalenessCutoff
            }
            .sorted { ($0.value.last?.timestamp ?? "") > ($1.value.last?.timestamp ?? "") }
            .map(\.key)
    }

    /// Total message count across all visible team threads.
    var totalMessageCount: Int {
        let visibleIds = Set(activeThreadIds)
        return teamThreads
            .filter { visibleIds.contains($0.key) }
            .values.reduce(0) { $0 + $1.count }
    }

    /// Get a display-friendly thread name.
    func threadDisplayName(_ threadId: String) -> String {
        if threadId.hasPrefix("thr-orch-") {
            let stripped = threadId.replacingOccurrences(of: "thr-orch-", with: "")
            let parts = stripped.split(separator: "-")
            if let first = parts.first { return "Team \(first)" }
        }
        // General thread: use the ID with thr- stripped
        let stripped = threadId.replacingOccurrences(of: "thr-", with: "")
        let parts = stripped.split(separator: "-")
        if let first = parts.first { return "Thread \(first)" }
        return threadId
    }

    /// Append a locally-sent message to a thread immediately (bidirectional messaging).
    /// The poll cycle will also pick this up via dedup (processedIds), so no duplicates.
    func appendLocalMessage(_ note: SymphonyNote) {
        processedIds.insert(note.id)
        guard let threadRoot = note.threadRoot else { return }
        var messages = teamThreads[threadRoot] ?? []
        if !messages.contains(where: { $0.id == note.id }) {
            messages.append(note)
            messages.sort { $0.timestamp < $1.timestamp }
            teamThreads[threadRoot] = messages
        }
    }

    /// Extract the originating project from a thread's first message.
    func threadProject(_ threadId: String) -> String? {
        guard let messages = teamThreads[threadId],
              let first = messages.first else { return nil }
        return first.sender.project
    }
}
