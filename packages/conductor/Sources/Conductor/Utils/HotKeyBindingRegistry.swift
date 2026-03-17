// HotKeyBindingRegistry.swift — #hotkey-binding-registry
// User-customizable hotkey → action bindings with persistence.

import Foundation
import Combine

/// Manages user-customizable hotkey → ConductorAction bindings.
@MainActor
final class HotKeyBindingRegistry: ObservableObject {

    /// Current hotkey bindings.
    @Published var bindings: [HotKeyBinding: ConductorAction]

    private let defaultsKey = "hotKeyBindings"

    /// Default bindings matching the hardcoded HotKeyManager registrations.
    static let defaultBindings: [HotKeyBinding: ConductorAction] = [
        .toggleVideo: .toggleVideo,
        .toggleVoice: .toggleVoice,
    ]

    init() {
        // Load from UserDefaults or use defaults
        if let data = UserDefaults.standard.data(forKey: "hotKeyBindings"),
           let saved = try? JSONDecoder().decode([String: String].self, from: data) {
            var loaded: [HotKeyBinding: ConductorAction] = [:]
            for (key, actionName) in saved {
                if let binding = Self.deserializeBinding(key),
                   let action = ActionRegistry.actionFromName(actionName) {
                    loaded[binding] = action
                }
            }
            self.bindings = loaded.isEmpty ? Self.defaultBindings : loaded
        } else {
            self.bindings = Self.defaultBindings
        }
    }

    // MARK: - CRUD

    func setBinding(_ binding: HotKeyBinding, action: ConductorAction) {
        bindings[binding] = action
        save()
    }

    func removeBinding(_ binding: HotKeyBinding) {
        bindings.removeValue(forKey: binding)
        save()
    }

    func resetToDefaults() {
        bindings = Self.defaultBindings
        save()
    }

    // MARK: - Serialization

    /// Serialize a HotKeyBinding to a string: "keyCode:modifiers.rawValue"
    static func serializeBinding(_ binding: HotKeyBinding) -> String {
        "\(binding.keyCode):\(binding.modifiers.rawValue)"
    }

    /// Deserialize from "keyCode:modifiers.rawValue"
    static func deserializeBinding(_ str: String) -> HotKeyBinding? {
        let parts = str.split(separator: ":")
        guard parts.count == 2,
              let keyCode = UInt16(parts[0]),
              let modRaw = UInt32(parts[1]) else {
            return nil
        }
        return HotKeyBinding(keyCode: keyCode, modifiers: HotKeyModifiers(rawValue: modRaw))
    }

    // MARK: - Persistence

    private func save() {
        var serialized: [String: String] = [:]
        for (binding, action) in bindings {
            serialized[Self.serializeBinding(binding)] = ActionRegistry.nameFromAction(action)
        }
        if let data = try? JSONEncoder().encode(serialized) {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        }
    }
}
