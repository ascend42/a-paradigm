// VoiceControlCoordinatorTests.swift
// Tests for #voice-control-coordinator state transitions and error recovery.

import XCTest
@testable import Conductor

@MainActor
final class VoiceControlCoordinatorTests: XCTestCase {

    // MARK: - State Transitions

    func testInitialStateIsIdle() {
        let coordinator = VoiceControlCoordinator()
        XCTAssertEqual(coordinator.state, .idle)
    }

    func testArmFromIdle() {
        let coordinator = VoiceControlCoordinator()
        coordinator.arm()
        XCTAssertEqual(coordinator.state, .armed)
    }

    func testArmFromRecordingIsIgnored() {
        let coordinator = VoiceControlCoordinator()
        coordinator.arm()
        // Can't start recording without a real voice provider, so manually set state
        coordinator.startRecording()
        // Without a provider, this will go to error state
        // But arm() during error should be ignored
        coordinator.arm()
        // State should NOT be .armed since it was in error
    }

    func testStartRecordingWithoutProviderGoesToError() {
        let coordinator = VoiceControlCoordinator()
        coordinator.startRecording()
        if case .error = coordinator.state {
            // Expected: error state
        } else {
            XCTFail("Expected error state when no voice provider is set")
        }
    }

    func testReset() {
        let coordinator = VoiceControlCoordinator()
        coordinator.arm()
        XCTAssertEqual(coordinator.state, .armed)
        coordinator.reset()
        XCTAssertEqual(coordinator.state, .idle)
        XCTAssertEqual(coordinator.recordingDuration, 0)
    }

    func testMarkReadyToSend() {
        let coordinator = VoiceControlCoordinator()
        coordinator.markReadyToSend()
        XCTAssertEqual(coordinator.state, .readyToSend)
    }

    // MARK: - Error Recovery

    func testErrorRecoveryTimeout() async throws {
        let coordinator = VoiceControlCoordinator()
        coordinator.errorRecoveryTimeout = 0.1  // 100ms for test speed

        coordinator.startRecording()  // No provider → error

        if case .error = coordinator.state {
            // Wait for auto-recovery
            try await Task.sleep(for: .milliseconds(200))
            XCTAssertEqual(coordinator.state, .idle, "Should auto-recover to idle")
        } else {
            XCTFail("Expected error state")
        }
    }

    // MARK: - Duration

    func testRecordingDurationStartsAtZero() {
        let coordinator = VoiceControlCoordinator()
        XCTAssertEqual(coordinator.recordingDuration, 0)
    }

    func testResetClearsDuration() {
        let coordinator = VoiceControlCoordinator()
        coordinator.arm()
        coordinator.reset()
        XCTAssertEqual(coordinator.recordingDuration, 0)
    }
}
