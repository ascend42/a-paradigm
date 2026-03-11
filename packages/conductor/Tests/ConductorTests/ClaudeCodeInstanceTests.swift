// ClaudeCodeInstanceTests.swift
// Tests for #conductor-models ClaudeCodeInstance identity and status.

import XCTest
@testable import Conductor

final class ClaudeCodeInstanceTests: XCTestCase {

    func testEqualityById() {
        let a = ClaudeCodeInstance(
            id: "window-1", windowID: 100, processID: 1234,
            title: "Project A", frame: .zero
        )
        let b = ClaudeCodeInstance(
            id: "window-1", windowID: 200, processID: 5678,
            title: "Different Title", frame: CGRect(x: 10, y: 10, width: 800, height: 600)
        )
        XCTAssertEqual(a, b, "Instances with same id should be equal")
    }

    func testInequalityById() {
        let a = ClaudeCodeInstance(
            id: "window-1", windowID: 100, processID: 1234,
            title: "Same Title", frame: .zero
        )
        let b = ClaudeCodeInstance(
            id: "window-2", windowID: 100, processID: 1234,
            title: "Same Title", frame: .zero
        )
        XCTAssertNotEqual(a, b, "Instances with different ids should not be equal")
    }

    func testDefaultStatusIsIdle() {
        let instance = ClaudeCodeInstance(
            id: "test", windowID: 1, processID: 1,
            title: "Test", frame: .zero
        )
        XCTAssertEqual(instance.status, .idle)
    }

    func testStatusTransition() {
        var instance = ClaudeCodeInstance(
            id: "test", windowID: 1, processID: 1,
            title: "Test", frame: .zero
        )
        XCTAssertEqual(instance.status, .idle)

        instance.status = .processing
        XCTAssertEqual(instance.status, .processing)

        instance.status = .finished
        XCTAssertEqual(instance.status, .finished)
    }

    func testDefaultAgentCountIsZero() {
        let instance = ClaudeCodeInstance(
            id: "test", windowID: 1, processID: 1,
            title: "Test", frame: .zero
        )
        XCTAssertEqual(instance.agentCount, 0)
    }

    func testIsTargetedDefaultFalse() {
        let instance = ClaudeCodeInstance(
            id: "test", windowID: 1, processID: 1,
            title: "Test", frame: .zero
        )
        XCTAssertFalse(instance.isTargeted)
    }
}
