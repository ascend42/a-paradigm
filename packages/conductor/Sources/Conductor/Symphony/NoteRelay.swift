// NoteRelay.swift — #note-relay
// 5-second polling relay that routes notes from outboxes to inboxes.
// Central nervous system of The Score in Conductor — ensures all agents
// can communicate without direct connections.

import Foundation

/// Polls agent outboxes and routes notes to the appropriate inboxes.
/// Runs on a 5-second timer, deduplicating by note ID and tracking cursor
/// positions within each outbox to avoid re-processing.
@MainActor
final class NoteRelay: ObservableObject {

    /// Whether the relay is currently active.
    @Published var isRelaying: Bool = false

    /// Total number of notes relayed since start.
    @Published var relayedNoteCount: Int = 0

    /// Active threads discovered from the threads directory.
    @Published var activeThreads: [ThreadMeta] = []

    /// Pending file requests discovered from the file-requests directory.
    @Published var pendingFileRequests: [FileRequestRecord] = []

    /// Background task running the relay loop.
    private var relayTask: Task<Void, Never>?

    /// Tracks how many lines we've already read in each agent's outbox.
    /// Key: agentId, Value: number of lines already processed.
    private var outboxCursors: [String: Int] = [:]

    /// Set of note IDs already relayed, used for deduplication.
    private var relayedNoteIds: Set<String> = []

    /// Relay poll interval in seconds.
    let pollInterval: TimeInterval = 5.0

    // MARK: - Start/Stop

    /// Begin the 5-second relay polling loop.
    func start() {
        guard !isRelaying else { return }

        isRelaying = true
        ConductorLog.component("note-relay").info("Relay started (interval: \(self.pollInterval)s)")

        relayTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.relayCycle()
                try? await Task.sleep(nanoseconds: UInt64(5_000_000_000))
            }
        }
    }

    /// Stop the relay loop.
    func stop() {
        relayTask?.cancel()
        relayTask = nil
        isRelaying = false
        ConductorLog.component("note-relay").info("Relay stopped")
    }

    // MARK: - Relay Cycle

    /// One full relay cycle: scan outboxes, route notes, update metadata.
    private func relayCycle() {
        let fm = FileManager.default
        let agentsPath = ScoreIO.agentsDir.path

        guard fm.fileExists(atPath: agentsPath) else { return }

        // Discover all agent IDs by scanning the two-level directory structure
        var agentIds: [String] = []
        if let projectDirs = try? fm.contentsOfDirectory(atPath: agentsPath) {
            for projectDir in projectDirs {
                let projectPath = ScoreIO.agentsDir.appendingPathComponent(projectDir).path
                var isDir: ObjCBool = false
                guard fm.fileExists(atPath: projectPath, isDirectory: &isDir), isDir.boolValue else { continue }

                if let roleDirs = try? fm.contentsOfDirectory(atPath: projectPath) {
                    for roleDir in roleDirs {
                        let rolePath = ScoreIO.agentsDir.appendingPathComponent(projectDir)
                            .appendingPathComponent(roleDir).path
                        var isDirRole: ObjCBool = false
                        guard fm.fileExists(atPath: rolePath, isDirectory: &isDirRole), isDirRole.boolValue else { continue }
                        agentIds.append("\(projectDir)/\(roleDir)")
                    }
                }
            }
        }

        var relayedThisCycle = 0

        // Process each agent's outbox
        for agentId in agentIds {
            let outboxPath = ScoreIO.outboxPath(for: agentId)
            let notes: [SymphonyNote] = ScoreIO.readJsonl(at: outboxPath)

            let cursor = outboxCursors[agentId] ?? 0

            // Only process notes after the cursor
            guard notes.count > cursor else { continue }
            let newNotes = Array(notes[cursor...])

            for note in newNotes {
                // Deduplicate by note ID
                guard !relayedNoteIds.contains(note.id) else { continue }

                routeNote(note, senderId: agentId, allAgentIds: agentIds)
                relayedNoteIds.insert(note.id)
                relayedThisCycle += 1
            }

            // Advance cursor
            outboxCursors[agentId] = notes.count
        }

        if relayedThisCycle > 0 {
            relayedNoteCount += relayedThisCycle
            ConductorLog.signal("note-relayed")
                .info("Relayed \(relayedThisCycle) note(s) (total: \(self.relayedNoteCount))")
        }

        // Update thread and file-request metadata
        refreshThreads()
        refreshFileRequests()
    }

    // MARK: - Routing

    /// Route a single note to the appropriate inboxes.
    /// If recipients are specified, deliver only to them.
    /// Otherwise, broadcast to all agents except the sender.
    private func routeNote(_ note: SymphonyNote, senderId: String, allAgentIds: [String]) {
        if let recipients = note.recipients, !recipients.isEmpty {
            // Direct message — deliver to specified recipients
            for recipient in recipients {
                let inboxPath = ScoreIO.inboxPath(for: recipient.id)
                ScoreIO.appendJsonl(note, to: inboxPath)
            }
        } else {
            // Broadcast — deliver to all agents except sender
            for agentId in allAgentIds {
                guard agentId != senderId else { continue }
                let inboxPath = ScoreIO.inboxPath(for: agentId)
                ScoreIO.appendJsonl(note, to: inboxPath)
            }
        }

        // Update thread metadata if applicable
        if let threadRoot = note.threadRoot {
            updateThreadForNote(note, threadId: threadRoot)
        }
    }

    /// Update thread metadata when a note is relayed.
    private func updateThreadForNote(_ note: SymphonyNote, threadId: String) {
        let threadPath = ScoreIO.threadPath(for: threadId)
        guard var thread: ThreadMeta = ScoreIO.readJson(at: threadPath) else { return }

        // Add sender to participants if not already there
        let isParticipant = thread.participants.contains(where: { $0.id == note.sender.id })
        if !isParticipant {
            thread.participants.append(note.sender)
        }

        thread.lastActivity = note.timestamp
        thread.messageCount += 1

        ScoreIO.writeJson(thread, to: threadPath)
    }

    // MARK: - Metadata Refresh

    /// Scan the threads directory and update the published list.
    private func refreshThreads() {
        let fm = FileManager.default
        let threadsPath = ScoreIO.threadsDir.path

        guard fm.fileExists(atPath: threadsPath) else {
            activeThreads = []
            return
        }

        guard let files = try? fm.contentsOfDirectory(atPath: threadsPath) else {
            activeThreads = []
            return
        }

        var threads: [ThreadMeta] = []
        for file in files where file.hasSuffix(".json") {
            let filePath = ScoreIO.threadsDir.appendingPathComponent(file)
            if let thread: ThreadMeta = ScoreIO.readJson(at: filePath) {
                threads.append(thread)
            }
        }

        // Sort by last activity (most recent first)
        threads.sort { $0.lastActivity > $1.lastActivity }
        activeThreads = threads
    }

    /// Scan the file-requests directory and update the published list.
    private func refreshFileRequests() {
        let fm = FileManager.default
        let requestsPath = ScoreIO.fileRequestsDir.path

        guard fm.fileExists(atPath: requestsPath) else {
            pendingFileRequests = []
            return
        }

        guard let files = try? fm.contentsOfDirectory(atPath: requestsPath) else {
            pendingFileRequests = []
            return
        }

        var requests: [FileRequestRecord] = []
        for file in files where file.hasSuffix(".json") {
            let filePath = ScoreIO.fileRequestsDir.appendingPathComponent(file)
            if let record: FileRequestRecord = ScoreIO.readJson(at: filePath) {
                if record.status == .pending {
                    requests.append(record)
                }
            }
        }

        // Sort by creation time (most recent first)
        requests.sort { $0.createdAt > $1.createdAt }
        pendingFileRequests = requests
    }
}
