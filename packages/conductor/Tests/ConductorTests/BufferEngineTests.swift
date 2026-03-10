// BufferEngineTests.swift
// Tests for the #text-buffer engine.

import XCTest
@testable import Conductor

@MainActor
final class BufferEngineTests: XCTestCase {

    func testAppend() {
        let buffer = BufferEngine()
        buffer.append("hello")
        XCTAssertEqual(buffer.text, "hello")
        XCTAssertEqual(buffer.cursorPosition, 5)
    }

    func testDeleteBackward() {
        let buffer = BufferEngine()
        buffer.append("hello")
        buffer.deleteBackward(count: 2)
        XCTAssertEqual(buffer.text, "hel")
        XCTAssertEqual(buffer.cursorPosition, 3)
    }

    func testUndo() {
        let buffer = BufferEngine()
        buffer.append("hello")
        buffer.append(" world")
        buffer.undo()
        XCTAssertEqual(buffer.text, "hello")
    }

    func testRedo() {
        let buffer = BufferEngine()
        buffer.append("hello")
        buffer.append(" world")
        buffer.undo()
        buffer.redo()
        XCTAssertEqual(buffer.text, "hello world")
    }

    func testFlush() {
        let buffer = BufferEngine()
        buffer.append("send this")
        let flushed = buffer.flush()
        XCTAssertEqual(flushed, "send this")
        XCTAssertTrue(buffer.isEmpty)
    }

    func testCursorMovement() {
        let buffer = BufferEngine()
        buffer.append("hello")
        buffer.moveCursorLeft(by: 3)
        XCTAssertEqual(buffer.cursorPosition, 2)
        buffer.moveCursorRight(by: 1)
        XCTAssertEqual(buffer.cursorPosition, 3)
    }

    func testCursorBounds() {
        let buffer = BufferEngine()
        buffer.append("hi")
        buffer.moveCursorLeft(by: 100)
        XCTAssertEqual(buffer.cursorPosition, 0)
        buffer.moveCursorRight(by: 100)
        XCTAssertEqual(buffer.cursorPosition, 2)
    }

    func testDeleteAtBeginning() {
        let buffer = BufferEngine()
        buffer.append("hi")
        buffer.moveCursorLeft(by: 2)
        buffer.deleteBackward()
        // Should be no-op at position 0
        XCTAssertEqual(buffer.text, "hi")
    }

    func testInsertAtCursor() {
        let buffer = BufferEngine()
        buffer.append("helo")
        buffer.moveCursorLeft(by: 1)
        buffer.append("l")
        XCTAssertEqual(buffer.text, "hello")
    }
}
