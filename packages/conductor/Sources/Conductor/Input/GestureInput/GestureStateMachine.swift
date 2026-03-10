// GestureStateMachine.swift — #gesture-state-machine
// Debounce, cooldowns, and state transitions for gesture recognition.
// Prevents rapid-fire gesture events and accidental triggers.

import Foundation

/// Processes raw HandState events into debounced GestureActions.
struct GestureStateMachine {
    /// Minimum time between gesture actions of the same type.
    var cooldownDuration: TimeInterval = 0.3

    /// How long a pinch must be sustained to trigger word-level delete.
    var sustainedPinchDuration: TimeInterval = 0.5

    /// Velocity threshold to distinguish character vs word cursor movement.
    var wordSwipeVelocity: Double = 0.5

    // State
    private var lastActionTime: Date = .distantPast
    private var lastActionType: String = ""
    private var pinchStartTime: Date?
    private var currentState: HandState = .none

    mutating func process(_ handState: HandState) -> GestureAction {
        let now = Date()
        let previousState = currentState
        currentState = handState

        // Cooldown check
        let actionKey = String(describing: handState)
        if actionKey == lastActionType && now.timeIntervalSince(lastActionTime) < cooldownDuration {
            return .none
        }

        let action: GestureAction

        switch handState {
        case .swipeLeft(let velocity):
            let granularity: CursorGranularity = velocity > wordSwipeVelocity ? .word : .character
            action = .cursorLeft(granularity: granularity)

        case .swipeRight(let velocity):
            let granularity: CursorGranularity = velocity > wordSwipeVelocity ? .word : .character
            action = .cursorRight(granularity: granularity)

        case .pinch:
            if previousState != .pinch {
                // Start tracking pinch duration
                pinchStartTime = now
                action = .deleteBackward(granularity: .character)
            } else if let start = pinchStartTime, now.timeIntervalSince(start) > sustainedPinchDuration {
                // Sustained pinch → word delete
                action = .deleteBackward(granularity: .word)
            } else {
                action = .none
            }

        case .fist:
            if previousState != .fist {
                action = .undo
            } else {
                action = .none
            }

        case .open:
            if previousState == .fist {
                // Fist → open = redo
                action = .redo
            } else {
                action = .none
            }

        case .twoFingerTap:
            if previousState != .twoFingerTap {
                action = .send
            } else {
                action = .none
            }

        case .none:
            pinchStartTime = nil
            action = .none
        }

        if action != .none {
            lastActionTime = now
            lastActionType = actionKey
        }

        return action
    }
}
