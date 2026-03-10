// GestureAction.swift — #conductor-models
// Hand gesture actions mapped from joint positions.

import Foundation

/// Actions produced by the gesture classifier from hand pose data.
enum GestureAction: Equatable {
    // Navigation
    case cursorLeft(granularity: CursorGranularity)
    case cursorRight(granularity: CursorGranularity)

    // Editing
    case deleteBackward(granularity: DeleteGranularity)
    case undo
    case redo

    // Dispatch
    case send

    // No recognized gesture
    case none
}

/// How far cursor moves per gesture.
enum CursorGranularity: Equatable {
    case character
    case word
    case line
}

/// How much to delete per gesture.
enum DeleteGranularity: Equatable {
    case character
    case word
}

/// Raw hand state detected from camera before classification.
enum HandState: Equatable {
    case open
    case fist
    case pinch
    case twoFingerTap
    case swipeLeft(velocity: Double)
    case swipeRight(velocity: Double)
    case none
}
