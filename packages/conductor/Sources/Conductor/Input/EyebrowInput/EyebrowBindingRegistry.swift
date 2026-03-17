// EyebrowBindingRegistry.swift — #eyebrow-binding-registry
// User-customizable eyebrow event → action bindings.

import Foundation

// MARK: - Eyebrow Event Kind

enum EyebrowEventKind: String, CaseIterable, Codable, Sendable {
    case leftRaise
    case leftLower
    case rightRaise
    case rightLower

    var displayName: String {
        switch self {
        case .leftRaise: return "Left Raise"
        case .leftLower: return "Left Lower"
        case .rightRaise: return "Right Raise"
        case .rightLower: return "Right Lower"
        }
    }

    /// Convert from EyebrowEvent.
    static func from(_ event: EyebrowEvent) -> EyebrowEventKind {
        switch event {
        case .leftRaise: return .leftRaise
        case .leftLower: return .leftLower
        case .rightRaise: return .rightRaise
        case .rightLower: return .rightLower
        }
    }
}

// MARK: - Eyebrow Binding Registry

/// Manages user-customizable eyebrow event → ConductorAction bindings.
/// When bindings are empty and useStateMachine is true, the default EyebrowStateMachine handles events.
@MainActor
final class EyebrowBindingRegistry: ObservableObject {

    /// Custom eyebrow event → action bindings. Empty by default (state machine handles).
    @Published var bindings: [EyebrowEventKind: ConductorAction] = [:]

    /// When true, use the built-in EyebrowStateMachine for event handling.
    /// When false, use direct bindings from this registry.
    @Published var useStateMachine: Bool = true

    private let defaultsKey = "eyebrowBindings"
    private let stateMachineKey = "eyebrowUseStateMachine"

    init() {
        load()
    }

    // MARK: - CRUD

    func setBinding(_ kind: EyebrowEventKind, action: ConductorAction) {
        bindings[kind] = action
        save()
    }

    func removeBinding(_ kind: EyebrowEventKind) {
        bindings.removeValue(forKey: kind)
        save()
    }

    func resetBindings() {
        bindings = [:]
        useStateMachine = true
        save()
    }

    // MARK: - Lookup

    /// Returns the action for an eyebrow event, or nil if not bound.
    func actionForEvent(_ event: EyebrowEvent) -> ConductorAction? {
        let kind = EyebrowEventKind.from(event)
        return bindings[kind]
    }

    // MARK: - Persistence

    private func save() {
        var serialized: [String: String] = [:]
        for (kind, action) in bindings {
            serialized[kind.rawValue] = ActionRegistry.nameFromAction(action)
        }
        if let data = try? JSONEncoder().encode(serialized) {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        }
        UserDefaults.standard.set(useStateMachine, forKey: stateMachineKey)
    }

    private func load() {
        useStateMachine = UserDefaults.standard.object(forKey: stateMachineKey) as? Bool ?? true

        guard let data = UserDefaults.standard.data(forKey: defaultsKey),
              let saved = try? JSONDecoder().decode([String: String].self, from: data) else {
            return
        }

        for (kindRaw, actionName) in saved {
            if let kind = EyebrowEventKind(rawValue: kindRaw),
               let action = ActionRegistry.actionFromName(actionName) {
                bindings[kind] = action
            }
        }
    }
}
