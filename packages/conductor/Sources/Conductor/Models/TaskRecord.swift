// TaskRecord.swift — #task-record, #task-store
// Task tracking models and persistent store for assigned tasks.
// Tracks lifecycle: assigned → acknowledged → inProgress → complete/failed.

import Foundation

// MARK: - Task Status

enum TaskStatus: String, Codable, Sendable {
    case assigned
    case acknowledged
    case inProgress
    case blocked
    case awaitingApproval
    case complete
    case failed
}

// MARK: - Timeline Event

struct TaskTimelineEvent: Codable, Identifiable, Sendable {
    let id: String
    let timestamp: Date
    let type: String  // "created", "acknowledged", "progress", "blocked", "approval", "complete", "failed"
    let summary: String
    var filesModified: [String]?
    var symbolsTouched: [String]?
    var blockers: [String]?
    var percent: Int?
}

// MARK: - Task Record

struct TaskRecord: Codable, Identifiable, Sendable {
    let id: String
    let scope: String
    let acceptance: String
    let priority: TaskPriority
    var assignedTo: [String]
    var status: TaskStatus
    var progress: Int  // 0–100
    var timeline: [TaskTimelineEvent]
    var filesModified: [String]
    var symbolsTouched: [String]
    var blockers: [String]
    let createdAt: Date
    var completedAt: Date?
    var externalRef: String?
}

// MARK: - Task Store

/// Persistent store for task records. Saves to ~/.paradigm/conductor/tasks.json.
@MainActor
final class TaskStore: ObservableObject {

    @Published private(set) var tasks: [TaskRecord] = []

    private let storePath: URL = {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".paradigm/conductor/tasks.json")
    }()

    init() {
        load()
    }

    // MARK: - Computed

    var activeTasks: [TaskRecord] {
        tasks.filter { [.assigned, .acknowledged, .inProgress].contains($0.status) }
    }

    var blockedTasks: [TaskRecord] {
        tasks.filter { $0.status == .blocked }
    }

    var awaitingApprovalTasks: [TaskRecord] {
        tasks.filter { $0.status == .awaitingApproval }
    }

    var completedTasks: [TaskRecord] {
        tasks.filter { [.complete, .failed].contains($0.status) }
    }

    /// Number of archived tasks (delegates to TaskArchiveIO).
    var archivedCount: Int {
        TaskArchiveIO.archiveCount()
    }

    // MARK: - Task Lifecycle

    /// Cancel an active task — sets status to .failed with "cancelled" timeline event.
    func cancelTask(id: String) {
        guard let idx = tasks.firstIndex(where: { $0.id == id }) else { return }
        // Only cancel active tasks
        guard ![TaskStatus.complete, .failed].contains(tasks[idx].status) else { return }

        tasks[idx].status = .failed
        tasks[idx].completedAt = .now
        appendEvent(to: &tasks[idx], type: "cancelled", summary: "Task cancelled by maestro")
        save()

        ConductorLog.signal("task-cancelled")
            .info("Task \(id) cancelled")
    }

    /// Re-assign a task to different agents. Calls sendNote closure with a SymphonyNote for each new assignee.
    func reassignTask(id: String, to newAssignees: [String], sendNote: ((SymphonyNote) -> Void)? = nil) {
        guard let idx = tasks.firstIndex(where: { $0.id == id }) else { return }

        let previousAssignees = tasks[idx].assignedTo
        tasks[idx].assignedTo = newAssignees
        appendEvent(
            to: &tasks[idx],
            type: "reassigned",
            summary: "Reassigned from \(previousAssignees.joined(separator: ", ")) to \(newAssignees.joined(separator: ", "))"
        )
        save()

        // Notify new assignees via Symphony
        if let sendNote {
            let note = SymphonyNote(
                id: UUID().uuidString,
                threadRoot: "thr-\(id)",
                timestamp: ISO8601DateFormatter().string(from: Date()),
                sender: Participant(id: "conductor/maestro", name: "Maestro", type: .agent),
                recipients: newAssignees.map { Participant(id: $0, name: $0, type: .agent) },
                intent: .task,
                content: MessageContent(text: "Task reassigned: \(tasks[idx].scope)"),
                symbols: tasks[idx].symbolsTouched,
                metadata: MessageMetadata(task: TaskPayload(
                    taskId: id,
                    scope: tasks[idx].scope,
                    acceptance: tasks[idx].acceptance,
                    priority: tasks[idx].priority,
                    externalRef: tasks[idx].externalRef
                ))
            )
            sendNote(note)
        }

        ConductorLog.signal("task-reassigned")
            .info("Task \(id) reassigned to \(newAssignees.joined(separator: ", "))")
    }

    /// Archive completed/failed tasks older than the given interval (default 7 days).
    func archiveCompleted(olderThan interval: TimeInterval = 7 * 24 * 60 * 60) {
        let cutoff = Date.now.addingTimeInterval(-interval)
        let toArchive = tasks.filter { task in
            [TaskStatus.complete, .failed].contains(task.status) &&
            (task.completedAt ?? task.createdAt) < cutoff
        }

        guard !toArchive.isEmpty else { return }

        TaskArchiveIO.archive(toArchive)
        let archivedIds = Set(toArchive.map(\.id))
        tasks.removeAll { archivedIds.contains($0.id) }
        save()

        ConductorLog.signal("tasks-archived")
            .info("Archived \(toArchive.count) tasks older than \(Int(interval / 86400))d")
    }

    /// Archive all completed/failed tasks regardless of age.
    func pruneCompleted() {
        let toArchive = tasks.filter { [TaskStatus.complete, .failed].contains($0.status) }
        guard !toArchive.isEmpty else { return }

        TaskArchiveIO.archive(toArchive)
        tasks.removeAll { [TaskStatus.complete, .failed].contains($0.status) }
        save()

        ConductorLog.signal("tasks-archived")
            .info("Pruned \(toArchive.count) completed/failed tasks to archive")
    }

    // MARK: - Task Creation

    /// Create a TaskRecord from a TaskPayload and add it to the store.
    func addTask(payload: TaskPayload, assignedTo: [String]) {
        let event = TaskTimelineEvent(
            id: UUID().uuidString,
            timestamp: .now,
            type: "created",
            summary: "Task assigned to \(assignedTo.joined(separator: ", "))"
        )

        let record = TaskRecord(
            id: payload.taskId,
            scope: payload.scope,
            acceptance: payload.acceptance,
            priority: payload.priority,
            assignedTo: assignedTo,
            status: .assigned,
            progress: 0,
            timeline: [event],
            filesModified: [],
            symbolsTouched: [],
            blockers: [],
            createdAt: .now,
            externalRef: payload.externalRef
        )

        tasks.append(record)
        save()

        ConductorLog.component("task-store")
            .info("Task \(payload.taskId) created — assigned to \(assignedTo.count) agent(s)")
    }

    // MARK: - Note Handling

    /// Dispatch a Symphony note to the appropriate handler based on intent.
    func handleNote(_ note: SymphonyNote) {
        switch note.intent {
        case .taskAck:
            handleTaskAck(note)
        case .progress:
            handleProgress(note)
        case .approvalRequest:
            handleApprovalRequest(note)
        case .taskComplete:
            handleTaskComplete(note)
        case .taskFailed:
            handleTaskFailed(note)
        default:
            break
        }
    }

    // MARK: - Intent Handlers

    private func handleTaskAck(_ note: SymphonyNote) {
        guard let taskId = extractTaskId(from: note) else { return }
        guard let idx = tasks.firstIndex(where: { $0.id == taskId }) else { return }

        tasks[idx].status = .acknowledged
        appendEvent(to: &tasks[idx], type: "acknowledged", summary: "Task acknowledged by \(note.sender.id)")
        save()
    }

    private func handleProgress(_ note: SymphonyNote) {
        guard let progressPayload = note.metadata?.progress else { return }
        guard let idx = tasks.firstIndex(where: { $0.id == progressPayload.taskId }) else { return }

        tasks[idx].status = progressPayload.blockers?.isEmpty == false ? .blocked : .inProgress
        tasks[idx].progress = min(100, max(0, progressPayload.percent))

        // Merge file/symbol tracking
        if let files = progressPayload.filesModified {
            for file in files where !tasks[idx].filesModified.contains(file) {
                tasks[idx].filesModified.append(file)
            }
        }
        if let symbols = progressPayload.symbolsTouched {
            for symbol in symbols where !tasks[idx].symbolsTouched.contains(symbol) {
                tasks[idx].symbolsTouched.append(symbol)
            }
        }
        if let blockers = progressPayload.blockers, !blockers.isEmpty {
            tasks[idx].blockers = blockers
        } else {
            tasks[idx].blockers = []
        }

        appendEvent(
            to: &tasks[idx],
            type: progressPayload.blockers?.isEmpty == false ? "blocked" : "progress",
            summary: progressPayload.summary,
            filesModified: progressPayload.filesModified,
            symbolsTouched: progressPayload.symbolsTouched,
            blockers: progressPayload.blockers,
            percent: progressPayload.percent
        )
        save()
    }

    private func handleApprovalRequest(_ note: SymphonyNote) {
        guard let approval = note.metadata?.approvalRequest else { return }
        guard let idx = tasks.firstIndex(where: { $0.id == approval.taskId }) else { return }

        tasks[idx].status = .awaitingApproval
        appendEvent(to: &tasks[idx], type: "approval", summary: "Approval requested: \(approval.summary)")
        save()
    }

    private func handleTaskComplete(_ note: SymphonyNote) {
        guard let taskId = extractTaskId(from: note) else { return }
        guard let idx = tasks.firstIndex(where: { $0.id == taskId }) else { return }

        tasks[idx].status = .complete
        tasks[idx].progress = 100
        tasks[idx].completedAt = .now
        appendEvent(to: &tasks[idx], type: "complete", summary: "Task completed by \(note.sender.id)")
        save()
    }

    private func handleTaskFailed(_ note: SymphonyNote) {
        guard let taskId = extractTaskId(from: note) else { return }
        guard let idx = tasks.firstIndex(where: { $0.id == taskId }) else { return }

        tasks[idx].status = .failed
        tasks[idx].completedAt = .now
        appendEvent(to: &tasks[idx], type: "failed", summary: note.content.text)
        save()
    }

    // MARK: - Helpers

    private func extractTaskId(from note: SymphonyNote) -> String? {
        // Try task payload first
        if let taskId = note.metadata?.task?.taskId { return taskId }
        if let taskId = note.metadata?.progress?.taskId { return taskId }
        if let taskId = note.metadata?.approvalRequest?.taskId { return taskId }
        if let taskId = note.metadata?.approvalResponse?.taskId { return taskId }
        // Fall back to threadRoot (format: "thr-task-XXXX" → "task-XXXX")
        if let threadRoot = note.threadRoot, threadRoot.hasPrefix("thr-") {
            return String(threadRoot.dropFirst(4))
        }
        return nil
    }

    private func appendEvent(
        to record: inout TaskRecord,
        type: String,
        summary: String,
        filesModified: [String]? = nil,
        symbolsTouched: [String]? = nil,
        blockers: [String]? = nil,
        percent: Int? = nil
    ) {
        let event = TaskTimelineEvent(
            id: UUID().uuidString,
            timestamp: .now,
            type: type,
            summary: summary,
            filesModified: filesModified,
            symbolsTouched: symbolsTouched,
            blockers: blockers,
            percent: percent
        )
        record.timeline.append(event)
    }

    // MARK: - Persistence

    private func save() {
        let fm = FileManager.default
        let dir = storePath.deletingLastPathComponent()
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        do {
            let data = try encoder.encode(tasks)
            try data.write(to: storePath, options: .atomic)
        } catch {
            ConductorLog.component("task-store")
                .info("Failed to save tasks: \(error.localizedDescription)")
        }
    }

    private func load() {
        let fm = FileManager.default
        guard fm.fileExists(atPath: storePath.path) else { return }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        do {
            let data = try Data(contentsOf: storePath)
            tasks = try decoder.decode([TaskRecord].self, from: data)
        } catch {
            ConductorLog.component("task-store")
                .info("Failed to load tasks: \(error.localizedDescription)")
        }
    }
}
