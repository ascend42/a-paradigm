// GestureStateMachineTests.swift
// Tests for #gesture-state-machine state transitions and cooldowns.

import XCTest
@testable import Conductor

final class GestureStateMachineTests: XCTestCase {

    func testIdleToSwipeLeft() {
        var sm = GestureStateMachine()
        sm.cooldownDuration = 0  // disable cooldown for deterministic tests
        let action = sm.process(.swipeLeft(velocity: 0.3))
        XCTAssertEqual(action, .cursorLeft(granularity: .character))
    }

    func testSwipeRightCharacterGranularity() {
        var sm = GestureStateMachine()
        sm.cooldownDuration = 0
        let action = sm.process(.swipeRight(velocity: 0.3))
        XCTAssertEqual(action, .cursorRight(granularity: .character))
    }

    func testSwipeRightWordGranularity() {
        var sm = GestureStateMachine()
        sm.cooldownDuration = 0
        sm.wordSwipeVelocity = 0.5
        let action = sm.process(.swipeRight(velocity: 0.8))
        XCTAssertEqual(action, .cursorRight(granularity: .word))
    }

    func testSwipeLeftWordGranularity() {
        var sm = GestureStateMachine()
        sm.cooldownDuration = 0
        sm.wordSwipeVelocity = 0.5
        let action = sm.process(.swipeLeft(velocity: 0.9))
        XCTAssertEqual(action, .cursorLeft(granularity: .word))
    }

    func testPinchFromIdleDeletesCharacter() {
        var sm = GestureStateMachine()
        sm.cooldownDuration = 0
        let action = sm.process(.pinch)
        XCTAssertEqual(action, .deleteBackward(granularity: .character))
    }

    func testFistFromIdleTriggersUndo() {
        var sm = GestureStateMachine()
        sm.cooldownDuration = 0
        let action = sm.process(.fist)
        XCTAssertEqual(action, .undo)
    }

    func testFistToOpenTriggersRedo() {
        var sm = GestureStateMachine()
        sm.cooldownDuration = 0
        _ = sm.process(.fist) // undo
        let action = sm.process(.open) // redo
        XCTAssertEqual(action, .redo)
    }

    func testOpenWithoutFistIsNone() {
        var sm = GestureStateMachine()
        sm.cooldownDuration = 0
        let action = sm.process(.open)
        XCTAssertEqual(action, .none)
    }

    func testTwoFingerTapSend() {
        var sm = GestureStateMachine()
        sm.cooldownDuration = 0
        let action = sm.process(.twoFingerTap)
        XCTAssertEqual(action, .send)
    }

    func testRepeatedTwoFingerTapIsNone() {
        var sm = GestureStateMachine()
        sm.cooldownDuration = 0
        _ = sm.process(.twoFingerTap)  // first → send
        let action = sm.process(.twoFingerTap) // second → none (same state)
        XCTAssertEqual(action, .none)
    }

    func testNoneHandStateIsNone() {
        var sm = GestureStateMachine()
        let action = sm.process(.none)
        XCTAssertEqual(action, .none)
    }

    func testCooldownBlocksSameAction() {
        var sm = GestureStateMachine()
        sm.cooldownDuration = 10 // very long cooldown
        // First swipe goes through
        let first = sm.process(.swipeLeft(velocity: 0.3))
        XCTAssertEqual(first, .cursorLeft(granularity: .character))
        // Reset to idle state then retry same action — cooldown blocks it
        _ = sm.process(.none)
        let second = sm.process(.swipeLeft(velocity: 0.3))
        XCTAssertEqual(second, .none)
    }
}
