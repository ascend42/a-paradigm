// TaskStoreTests.swift
// Tests for #task-store — task lifecycle, note handling, computed properties.

import XCTest
@testable import Conductor

@MainActor
final class TaskStoreTests: XCTestCase {

    /// Clean up persisted tasks before each test to avoid cross-contamination.
    override func setUp() {
        super.setUp()
        let home = FileManager.default.homeDirectoryForCurrentUser
        let path = home.appendingPathComponent(".paradigm/conductor/tasks.json")
        try? FileManager.default.removeItem(at: path)
    }

    private func makeStore() -> TaskStore {
        TaskStore()
    }

    private func makePayload(taskId: String = "task-test123") -> TaskPayload {
        TaskPayload(
            taskId: taskId,
            scope: "Implement feature X",
            acceptance: "Tests pass, no regressions",
            priority: .normal,
            externalRef: nil,
            assignedBy: "conductor/maestro"
        )
    }

    private func makeNote(
        intent: MessageIntent,
        taskId: String = "task-test123",
        senderId: String = "project/agent",
        content: String = "",
        metadata: MessageMetadata? = nil
    ) -> SymphonyNote {
        SymphonyNote(
            id: UUID().uuidString,
            threadRoot: "thr-\(taskId)",
            timestamp: ISO8601DateFormatter().string(from: Date()),
            sender: Participant(id: senderId, name: senderId, type: .agent),
            intent: intent,
            content: MessageContent(text: content),
            symbols: [],
            metadata: metadata
        )
    }

    // MARK: - Tests

    func testAddTask() {
        let store = makeStore()
        let payload = makePayload()
        store.addTask(payload: payload, assignedTo: ["project/agent"])

        XCTAssertEqual(store.tasks.count, 1)
        XCTAssertEqual(store.tasks[0].id, "task-test123")
        XCTAssertEqual(store.tasks[0].status, .assigned)
        XCTAssertEqual(store.tasks[0].progress, 0)
        XCTAssertEqual(store.tasks[0].assignedTo, ["project/agent"])
        XCTAssertEqual(store.tasks[0].timeline.count, 1)
    }

    func testHandleAck() {
        let store = makeStore()
        store.addTask(payload: makePayload(), assignedTo: ["project/agent"])

        let note = makeNote(
            intent: .taskAck,
            metadata: MessageMetadata(task: makePayload())
        )
        store.handleNote(note)

        XCTAssertEqual(store.tasks[0].status, .acknowledged)
        XCTAssertEqual(store.tasks[0].timeline.count, 2)
    }

    func testHandleProgress() {
        let store = makeStore()
        store.addTask(payload: makePayload(), assignedTo: ["project/agent"])

        let progressPayload = ProgressPayload(
            taskId: "task-test123",
            percent: 50,
            summary: "Halfway there",
            filesModified: ["src/main.ts"],
            symbolsTouched: ["#feature"]
        )
        let note = makeNote(
            intent: .progress,
            metadata: MessageMetadata(progress: progressPayload)
        )
        store.handleNote(note)

        XCTAssertEqual(store.tasks[0].status, .inProgress)
        XCTAssertEqual(store.tasks[0].progress, 50)
        XCTAssertEqual(store.tasks[0].filesModified, ["src/main.ts"])
        XCTAssertEqual(store.tasks[0].symbolsTouched, ["#feature"])
    }

    func testHandleApprovalRequest() {
        let store = makeStore()
        store.addTask(payload: makePayload(), assignedTo: ["project/agent"])

        let approval = ApprovalRequestPayload(
            taskId: "task-test123",
            summary: "Ready for review",
            filesModified: ["src/main.ts"],
            question: "Approve?",
            options: ["Approve", "Reject"]
        )
        let note = makeNote(
            intent: .approvalRequest,
            metadata: MessageMetadata(approvalRequest: approval)
        )
        store.handleNote(note)

        XCTAssertEqual(store.tasks[0].status, .awaitingApproval)
    }

    func testHandleComplete() {
        let store = makeStore()
        store.addTask(payload: makePayload(), assignedTo: ["project/agent"])

        let note = makeNote(
            intent: .taskComplete,
            metadata: MessageMetadata(task: makePayload())
        )
        store.handleNote(note)

        XCTAssertEqual(store.tasks[0].status, .complete)
        XCTAssertEqual(store.tasks[0].progress, 100)
        XCTAssertNotNil(store.tasks[0].completedAt)
    }

    func testHandleFailed() {
        let store = makeStore()
        store.addTask(payload: makePayload(), assignedTo: ["project/agent"])

        let note = makeNote(
            intent: .taskFailed,
            content: "Build failed",
            metadata: MessageMetadata(task: makePayload())
        )
        store.handleNote(note)

        XCTAssertEqual(store.tasks[0].status, .failed)
        XCTAssertNotNil(store.tasks[0].completedAt)
    }

    func testTimelineAccumulation() {
        let store = makeStore()
        store.addTask(payload: makePayload(), assignedTo: ["project/agent"])

        // Ack
        store.handleNote(makeNote(intent: .taskAck, metadata: MessageMetadata(task: makePayload())))

        // Progress 25%
        store.handleNote(makeNote(
            intent: .progress,
            metadata: MessageMetadata(progress: ProgressPayload(taskId: "task-test123", percent: 25, summary: "Started"))
        ))

        // Progress 75%
        store.handleNote(makeNote(
            intent: .progress,
            metadata: MessageMetadata(progress: ProgressPayload(taskId: "task-test123", percent: 75, summary: "Almost done"))
        ))

        // Complete
        store.handleNote(makeNote(intent: .taskComplete, metadata: MessageMetadata(task: makePayload())))

        XCTAssertEqual(store.tasks[0].timeline.count, 5) // created + ack + 2 progress + complete
    }

    func testFilesModifiedUnion() {
        let store = makeStore()
        store.addTask(payload: makePayload(), assignedTo: ["project/agent"])

        // First progress with file A
        store.handleNote(makeNote(
            intent: .progress,
            metadata: MessageMetadata(progress: ProgressPayload(
                taskId: "task-test123", percent: 30, summary: "p1",
                filesModified: ["a.ts"]
            ))
        ))

        // Second progress with file A (dupe) + B
        store.handleNote(makeNote(
            intent: .progress,
            metadata: MessageMetadata(progress: ProgressPayload(
                taskId: "task-test123", percent: 60, summary: "p2",
                filesModified: ["a.ts", "b.ts"]
            ))
        ))

        XCTAssertEqual(store.tasks[0].filesModified.sorted(), ["a.ts", "b.ts"])
    }

    func testComputedProperties() {
        let store = makeStore()

        store.addTask(payload: makePayload(taskId: "task-1"), assignedTo: ["a"])
        store.addTask(payload: makePayload(taskId: "task-2"), assignedTo: ["b"])
        store.addTask(payload: makePayload(taskId: "task-3"), assignedTo: ["c"])

        // Mark task-2 as complete
        store.handleNote(makeNote(intent: .taskComplete, taskId: "task-2", metadata: MessageMetadata(task: makePayload(taskId: "task-2"))))

        // Mark task-3 as blocked
        store.handleNote(makeNote(
            intent: .progress, taskId: "task-3",
            metadata: MessageMetadata(progress: ProgressPayload(
                taskId: "task-3", percent: 10, summary: "Blocked",
                blockers: ["Missing API key"]
            ))
        ))

        XCTAssertEqual(store.activeTasks.count, 1) // task-1 (assigned)
        XCTAssertEqual(store.completedTasks.count, 1) // task-2
        XCTAssertEqual(store.blockedTasks.count, 1) // task-3
    }

    func testUnknownTaskIdIgnored() {
        let store = makeStore()
        store.addTask(payload: makePayload(), assignedTo: ["project/agent"])

        // Note for a different task ID
        let note = makeNote(
            intent: .taskAck,
            taskId: "task-unknown",
            metadata: MessageMetadata(task: TaskPayload(
                taskId: "task-unknown",
                scope: "x", acceptance: "y", priority: .low
            ))
        )
        store.handleNote(note)

        // Original task unchanged
        XCTAssertEqual(store.tasks[0].status, .assigned)
    }

    // MARK: - Sprint 14: Lifecycle Tests

    func testCancelTask() {
        let store = makeStore()
        store.addTask(payload: makePayload(), assignedTo: ["project/agent"])

        store.cancelTask(id: "task-test123")

        XCTAssertEqual(store.tasks[0].status, .failed)
        XCTAssertNotNil(store.tasks[0].completedAt)
        XCTAssertEqual(store.tasks[0].timeline.last?.type, "cancelled")
    }

    func testCancelCompletedTaskIsNoOp() {
        let store = makeStore()
        store.addTask(payload: makePayload(), assignedTo: ["project/agent"])

        // Complete the task first
        store.handleNote(makeNote(
            intent: .taskComplete,
            metadata: MessageMetadata(task: makePayload())
        ))
        XCTAssertEqual(store.tasks[0].status, .complete)

        // Try to cancel — should be no-op
        store.cancelTask(id: "task-test123")
        XCTAssertEqual(store.tasks[0].status, .complete)
        // Timeline should still end with "complete", not "cancelled"
        XCTAssertEqual(store.tasks[0].timeline.last?.type, "complete")
    }

    func testReassignTask() {
        let store = makeStore()
        store.addTask(payload: makePayload(), assignedTo: ["project/agent-a"])

        var sentNote: SymphonyNote?
        store.reassignTask(id: "task-test123", to: ["project/agent-b"]) { note in
            sentNote = note
        }

        XCTAssertEqual(store.tasks[0].assignedTo, ["project/agent-b"])
        XCTAssertEqual(store.tasks[0].timeline.last?.type, "reassigned")
        XCTAssertNotNil(sentNote)
        XCTAssertEqual(sentNote?.intent, .task)
    }

    func testArchiveCompleted() {
        let store = makeStore()
        // Clean archive first
        try? FileManager.default.removeItem(at: TaskArchiveIO.archivePath)

        store.addTask(payload: makePayload(taskId: "task-old"), assignedTo: ["a"])
        store.addTask(payload: makePayload(taskId: "task-new"), assignedTo: ["b"])

        // Complete both
        store.handleNote(makeNote(intent: .taskComplete, taskId: "task-old", metadata: MessageMetadata(task: makePayload(taskId: "task-old"))))
        store.handleNote(makeNote(intent: .taskComplete, taskId: "task-new", metadata: MessageMetadata(task: makePayload(taskId: "task-new"))))

        // Archive with 0 interval (everything older than now)
        store.archiveCompleted(olderThan: 0)

        // Both should be archived since completedAt <= now
        XCTAssertEqual(store.tasks.count, 0)
        XCTAssertEqual(TaskArchiveIO.archiveCount(), 2)

        // Clean up
        try? FileManager.default.removeItem(at: TaskArchiveIO.archivePath)
    }

    func testPruneCompleted() {
        let store = makeStore()
        try? FileManager.default.removeItem(at: TaskArchiveIO.archivePath)

        store.addTask(payload: makePayload(taskId: "task-active"), assignedTo: ["a"])
        store.addTask(payload: makePayload(taskId: "task-done"), assignedTo: ["b"])

        // Complete only one
        store.handleNote(makeNote(intent: .taskComplete, taskId: "task-done", metadata: MessageMetadata(task: makePayload(taskId: "task-done"))))

        store.pruneCompleted()

        XCTAssertEqual(store.tasks.count, 1) // active one remains
        XCTAssertEqual(store.tasks[0].id, "task-active")

        // Clean up
        try? FileManager.default.removeItem(at: TaskArchiveIO.archivePath)
    }

    func testArchivedCount() {
        try? FileManager.default.removeItem(at: TaskArchiveIO.archivePath)

        XCTAssertEqual(TaskArchiveIO.archiveCount(), 0)

        let record = TaskRecord(
            id: "task-count-test",
            scope: "test",
            acceptance: "test",
            priority: .normal,
            assignedTo: ["a"],
            status: .complete,
            progress: 100,
            timeline: [],
            filesModified: [],
            symbolsTouched: [],
            blockers: [],
            createdAt: .now,
            completedAt: .now
        )
        TaskArchiveIO.archive([record])
        XCTAssertEqual(TaskArchiveIO.archiveCount(), 1)

        // Clean up
        try? FileManager.default.removeItem(at: TaskArchiveIO.archivePath)
    }
}
