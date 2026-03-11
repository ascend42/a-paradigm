// EyebrowStateMachine.swift — #eyebrow-state-machine
// Pure state machine for eyebrow-driven voice control.
// Flow: idle → armed → recording → stopped → send

import Foundation

/// State machine mapping eyebrow events to voice control transitions.
///
/// Left eyebrow raise: arm/start recording
/// Left eyebrow lower: stop recording
/// Right eyebrow raise: dispatch/send
///
/// States:
/// - `.idle`: waiting for left raise to arm
/// - `.armed`: left raised, ready to start recording on lower
/// - `.recording`: left lowered after arm, voice recording active
/// - `.stopped`: left raised again to stop recording
/// - `.send`: right raised to dispatch — auto-resets to idle
struct EyebrowStateMachine {

    enum State: Equatable {
        case idle
        case armed
        case recording
        case stopped
        case send
    }

    /// Current state.
    private(set) var state: State = .idle

    /// Minimum time between state transitions to prevent flutter.
    var cooldownDuration: TimeInterval = 0.3

    /// Timestamp of last state transition.
    private var lastTransitionTime: Date = .distantPast

    /// Process an eyebrow event and return an optional ConductorAction.
    mutating func process(_ event: EyebrowEvent) -> ConductorAction? {
        let now = Date()
        guard now.timeIntervalSince(lastTransitionTime) >= cooldownDuration else {
            return nil
        }

        switch (state, event) {
        case (.idle, .leftRaise):
            state = .armed
            lastTransitionTime = now
            return .voiceArm

        case (.armed, .leftLower):
            state = .recording
            lastTransitionTime = now
            return .voiceStart

        case (.armed, .rightRaise):
            // Cancel — go back to idle
            state = .idle
            lastTransitionTime = now
            return nil

        case (.recording, .leftRaise):
            state = .stopped
            lastTransitionTime = now
            return .voiceStop

        case (.stopped, .rightRaise):
            state = .idle
            lastTransitionTime = now
            return .send

        case (.stopped, .leftRaise):
            // Re-arm for recording
            state = .armed
            lastTransitionTime = now
            return .voiceArm

        case (.stopped, .leftLower):
            // Re-enter recording
            state = .recording
            lastTransitionTime = now
            return .voiceStart

        default:
            // Ignore irrelevant events
            return nil
        }
    }

    /// Reset to idle state.
    mutating func reset() {
        state = .idle
        lastTransitionTime = .distantPast
    }
}
