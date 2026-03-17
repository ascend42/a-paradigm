// TaskArchiveTests.swift
// Tests for #task-archive — archive IO, append, count.

import XCTest
@testable import Conductor

@MainActor
final class TaskArchiveTests: XCTestCase {

    override func setUp() {
        super.setUp()
        // Clean up archive file before each test
        try? FileManager.default.removeItem(at: TaskArchiveIO.archivePath)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: TaskArchiveIO.archivePath)
        super.tearDown()
    }

    private func makeRecord(id: String = "task-archive-test") -> TaskRecord {
        TaskRecord(
            id: id,
            scope: "Test scope",
            acceptance: "Tests pass",
            priority: .normal,
            assignedTo: ["project/agent"],
            status: .complete,
            progress: 100,
            timeline: [],
            filesModified: [],
            symbolsTouched: [],
            blockers: [],
            createdAt: .now,
            completedAt: .now
        )
    }

    func testArchiveAndLoad() {
        let record = makeRecord()
        TaskArchiveIO.archive([record])

        let loaded = TaskArchiveIO.loadArchive()
        XCTAssertEqual(loaded.count, 1)
        XCTAssertEqual(loaded[0].record.id, "task-archive-test")
        XCTAssertEqual(loaded[0].record.status, .complete)
    }

    func testArchiveAppends() {
        TaskArchiveIO.archive([makeRecord(id: "task-1")])
        TaskArchiveIO.archive([makeRecord(id: "task-2")])

        let loaded = TaskArchiveIO.loadArchive()
        XCTAssertEqual(loaded.count, 2)
        XCTAssertEqual(loaded[0].record.id, "task-1")
        XCTAssertEqual(loaded[1].record.id, "task-2")
    }

    func testArchiveCountMatchesLoad() {
        TaskArchiveIO.archive([makeRecord(id: "task-a"), makeRecord(id: "task-b")])
        TaskArchiveIO.archive([makeRecord(id: "task-c")])

        let count = TaskArchiveIO.archiveCount()
        let loaded = TaskArchiveIO.loadArchive()
        XCTAssertEqual(count, loaded.count)
        XCTAssertEqual(count, 3)
    }
}
