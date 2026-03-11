// EyebrowStateMachineTests.swift
// Tests for #eyebrow-state-machine state transitions and cooldowns.

import XCTest
@testable import Conductor

final class EyebrowStateMachineTests: XCTestCase {

    // MARK: - Basic Flow: idle → armed → recording → stopped → send

    func testIdleToArmedOnLeftRaise() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 0
        let action = sm.process(.leftRaise)
        XCTAssertEqual(action, .voiceArm, "Arming should produce voiceArm action")
        XCTAssertEqual(sm.state, .armed)
    }

    func testArmedToRecordingOnLeftLower() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 0
        _ = sm.process(.leftRaise)  // → armed
        let action = sm.process(.leftLower)
        XCTAssertEqual(action, .voiceStart)
        XCTAssertEqual(sm.state, .recording)
    }

    func testRecordingToStoppedOnLeftRaise() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 0
        _ = sm.process(.leftRaise)   // → armed
        _ = sm.process(.leftLower)   // → recording
        let action = sm.process(.leftRaise)
        XCTAssertEqual(action, .voiceStop)
        XCTAssertEqual(sm.state, .stopped)
    }

    func testStoppedToSendOnRightRaise() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 0
        _ = sm.process(.leftRaise)   // → armed
        _ = sm.process(.leftLower)   // → recording (voiceStart)
        _ = sm.process(.leftRaise)   // → stopped (voiceStop)
        let action = sm.process(.rightRaise)
        XCTAssertEqual(action, .send)
        XCTAssertEqual(sm.state, .idle, "Should auto-reset to idle after send")
    }

    // MARK: - Cancel / Re-record

    func testArmedCancelledByRightRaise() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 0
        _ = sm.process(.leftRaise)   // → armed
        let action = sm.process(.rightRaise)
        XCTAssertNil(action, "Cancelling should not produce an action")
        XCTAssertEqual(sm.state, .idle)
    }

    func testStoppedToRearmOnLeftRaise() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 0
        _ = sm.process(.leftRaise)   // → armed
        _ = sm.process(.leftLower)   // → recording
        _ = sm.process(.leftRaise)   // → stopped
        let action = sm.process(.leftRaise) // re-arm
        XCTAssertEqual(action, .voiceArm, "Re-arming should produce voiceArm action")
        XCTAssertEqual(sm.state, .armed)
    }

    func testStoppedToReRecordOnLeftLower() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 0
        _ = sm.process(.leftRaise)   // → armed
        _ = sm.process(.leftLower)   // → recording
        _ = sm.process(.leftRaise)   // → stopped
        let action = sm.process(.leftLower)  // re-record
        XCTAssertEqual(action, .voiceStart)
        XCTAssertEqual(sm.state, .recording)
    }

    // MARK: - Ignored Events

    func testIdleIgnoresRightRaise() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 0
        let action = sm.process(.rightRaise)
        XCTAssertNil(action)
        XCTAssertEqual(sm.state, .idle)
    }

    func testIdleIgnoresLeftLower() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 0
        let action = sm.process(.leftLower)
        XCTAssertNil(action)
        XCTAssertEqual(sm.state, .idle)
    }

    func testRecordingIgnoresRightRaise() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 0
        _ = sm.process(.leftRaise)   // → armed
        _ = sm.process(.leftLower)   // → recording
        let action = sm.process(.rightRaise)
        XCTAssertNil(action)
        XCTAssertEqual(sm.state, .recording, "Right raise during recording should be ignored")
    }

    // MARK: - Cooldown

    func testCooldownBlocksRapidTransitions() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 10  // very long cooldown
        _ = sm.process(.leftRaise)  // → armed (uses up cooldown)
        let action = sm.process(.leftLower)  // blocked by cooldown
        XCTAssertNil(action)
        XCTAssertEqual(sm.state, .armed, "Should stay armed due to cooldown")
    }

    // MARK: - Reset

    func testReset() {
        var sm = EyebrowStateMachine()
        sm.cooldownDuration = 0
        _ = sm.process(.leftRaise)
        _ = sm.process(.leftLower)
        XCTAssertEqual(sm.state, .recording)
        sm.reset()
        XCTAssertEqual(sm.state, .idle)
    }
}
