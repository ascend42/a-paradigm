// ConductorAction.swift — #conductor-models
// Unified action enum for all input types.
// All inputs (eyebrow, gesture, voice command, keyboard) route through this.

import Foundation

/// Every user-triggerable action in Conductor, regardless of input source.
enum ConductorAction: Equatable {
    // Voice control
    case voiceArm
    case voiceStart
    case voiceStop

    // Dispatch
    case send

    // Buffer editing
    case undo
    case redo
    case cursorLeft(granularity: CursorGranularity)
    case cursorRight(granularity: CursorGranularity)
    case deleteBackward(granularity: DeleteGranularity)

    // Workspace
    case switchToCell(Int)

    // Input toggles
    case toggleVideo
    case toggleVoice
    case muteVideo
    case muteVoice
    case unmuteVideo
    case unmuteVoice

    // Extensible — for custom gesture or voice command bindings
    case custom(String)
}
