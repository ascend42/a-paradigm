// VoiceCommandRegistry.swift — #voice-command-registry
// CRUD for voice phrase→action mappings.
// Default commands + user-defined. Persisted to UserDefaults.

import Foundation

/// Manages voice command phrase→action bindings.
@MainActor
final class VoiceCommandRegistry: ObservableObject {

    // MARK: - Published State

    @Published private(set) var commands: [String: ConductorAction]

    // MARK: - Default Commands

    static let defaultCommands: [String: ConductorAction] = [
        "send": .send,
        "send it": .send,
        "undo": .undo,
        "undo that": .undo,
        "redo": .redo,
        "cancel": .voiceStop,
        // Symphony file request commands — "approve" acts on the most recent pending request
        "approve": .approveFileRequest("latest"),
        "deny": .denyFileRequest("latest"),
        "approve redacted": .approveFileRequestRedacted("latest"),
    ]

    // MARK: - Init

    init() {
        // Load from UserDefaults, falling back to defaults
        if let data = UserDefaults.standard.data(forKey: "voiceCommands"),
           let saved = try? JSONDecoder().decode([String: String].self, from: data) {
            var commands: [String: ConductorAction] = [:]
            for (phrase, actionName) in saved {
                if let action = ActionRegistry.actionFromName(actionName) {
                    commands[phrase] = action
                }
            }
            self.commands = commands.isEmpty ? Self.defaultCommands : commands
        } else {
            self.commands = Self.defaultCommands
        }
    }

    // MARK: - CRUD

    /// Add or update a voice command.
    func setCommand(phrase: String, action: ConductorAction) {
        commands[phrase.lowercased()] = action
        save()
    }

    /// Remove a voice command.
    func removeCommand(phrase: String) {
        commands.removeValue(forKey: phrase.lowercased())
        save()
    }

    /// Reset to default commands.
    func resetToDefaults() {
        commands = Self.defaultCommands
        UserDefaults.standard.removeObject(forKey: "voiceCommands")
    }

    // MARK: - Persistence

    private func save() {
        var serialized: [String: String] = [:]
        for (phrase, action) in commands {
            serialized[phrase] = ActionRegistry.nameFromAction(action)
        }
        if let data = try? JSONEncoder().encode(serialized) {
            UserDefaults.standard.set(data, forKey: "voiceCommands")
        }
    }
}
