// ActionRegistry.swift — #action-registry
// Maps input events to ConductorAction values.
// Default bindings for eyebrow, gesture, and keyboard inputs.
// Designed for user-customizable bindings (Sprint 13).

import Foundation

/// Central registry for input→action bindings.
/// Persists custom overrides to UserDefaults.
@MainActor
final class ActionRegistry: ObservableObject {

    // MARK: - Binding Types

    /// Maps an eyebrow event to an action.
    struct EyebrowBinding: Codable, Equatable {
        let event: String  // "leftRaise", "leftLower", "rightRaise", "rightLower"
        let action: String // Serialized ConductorAction name
    }

    /// Maps a gesture to an action.
    struct GestureBinding: Codable, Equatable {
        let gesture: String // GestureAction name
        let action: String  // ConductorAction name
    }

    // MARK: - Default Bindings

    /// Default gesture-to-action mappings (matches existing GestureStateMachine behavior).
    static let defaultGestureBindings: [String: ConductorAction] = [
        "pinch": .deleteBackward(granularity: .character),
        "fist": .undo,
        "open_after_fist": .redo,
        "twoFingerTap": .send,
        "swipeLeft": .cursorLeft(granularity: .character),
        "swipeRight": .cursorRight(granularity: .character),
    ]

    // MARK: - Published State

    @Published private(set) var gestureBindings: [String: ConductorAction]

    // MARK: - Init

    init() {
        // Load custom bindings from UserDefaults, falling back to defaults
        if let data = UserDefaults.standard.data(forKey: "customGestureBindings"),
           let saved = try? JSONDecoder().decode([String: String].self, from: data) {
            var bindings: [String: ConductorAction] = [:]
            for (gesture, actionName) in saved {
                if let action = Self.actionFromName(actionName) {
                    bindings[gesture] = action
                }
            }
            self.gestureBindings = bindings.isEmpty ? Self.defaultGestureBindings : bindings
        } else {
            self.gestureBindings = Self.defaultGestureBindings
        }
    }

    // MARK: - Lookup

    /// Resolve a GestureAction to a ConductorAction.
    func actionForGesture(_ gesture: GestureAction) -> ConductorAction? {
        switch gesture {
        case .cursorLeft(let g):
            return .cursorLeft(granularity: g)
        case .cursorRight(let g):
            return .cursorRight(granularity: g)
        case .deleteBackward(let g):
            return .deleteBackward(granularity: g)
        case .undo:
            return .undo
        case .redo:
            return .redo
        case .send:
            return .send
        case .none:
            return nil
        }
    }

    // MARK: - Persistence

    /// Save current bindings to UserDefaults.
    func save() {
        var serialized: [String: String] = [:]
        for (gesture, action) in gestureBindings {
            serialized[gesture] = Self.nameFromAction(action)
        }
        if let data = try? JSONEncoder().encode(serialized) {
            UserDefaults.standard.set(data, forKey: "customGestureBindings")
        }
    }

    /// Reset to default bindings.
    func resetToDefaults() {
        gestureBindings = Self.defaultGestureBindings
        UserDefaults.standard.removeObject(forKey: "customGestureBindings")
    }

    // MARK: - Serialization Helpers

    static func actionFromName(_ name: String) -> ConductorAction? {
        switch name {
        case "voiceArm": return .voiceArm
        case "voiceStart": return .voiceStart
        case "voiceStop": return .voiceStop
        case "send": return .send
        case "undo": return .undo
        case "redo": return .redo
        case "deleteChar": return .deleteBackward(granularity: .character)
        case "deleteWord": return .deleteBackward(granularity: .word)
        case "cursorLeftChar": return .cursorLeft(granularity: .character)
        case "cursorLeftWord": return .cursorLeft(granularity: .word)
        case "cursorRightChar": return .cursorRight(granularity: .character)
        case "cursorRightWord": return .cursorRight(granularity: .word)
        default:
            if name.hasPrefix("custom:") {
                return .custom(String(name.dropFirst(7)))
            }
            return nil
        }
    }

    static func nameFromAction(_ action: ConductorAction) -> String {
        switch action {
        case .voiceArm: return "voiceArm"
        case .voiceStart: return "voiceStart"
        case .voiceStop: return "voiceStop"
        case .send: return "send"
        case .undo: return "undo"
        case .redo: return "redo"
        case .deleteBackward(.character): return "deleteChar"
        case .deleteBackward(.word): return "deleteWord"
        case .cursorLeft(.character): return "cursorLeftChar"
        case .cursorLeft(.word): return "cursorLeftWord"
        case .cursorLeft(.line): return "cursorLeftLine"
        case .cursorRight(.character): return "cursorRightChar"
        case .cursorRight(.word): return "cursorRightWord"
        case .cursorRight(.line): return "cursorRightLine"
        case .switchToCell(let i): return "switchToCell:\(i)"
        case .custom(let name): return "custom:\(name)"
        }
    }
}
