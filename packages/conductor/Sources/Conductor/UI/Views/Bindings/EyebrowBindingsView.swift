// EyebrowBindingsView.swift — #eyebrow-bindings-view
// Extracted from BindingsManagerView — eyebrow event binding management.

import SwiftUI

struct EyebrowBindingsView: View {
    var eyebrowBindingRegistry: EyebrowBindingRegistry

    var body: some View {
        Section("Eyebrow Bindings") {
            Toggle("Use state machine (default)", isOn: Binding(
                get: { eyebrowBindingRegistry.useStateMachine },
                set: { eyebrowBindingRegistry.useStateMachine = $0 }
            ))
            .font(.caption)

            if !eyebrowBindingRegistry.useStateMachine {
                Text("Direct mode: each eyebrow event maps to one action.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                ForEach(EyebrowEventKind.allCases, id: \.self) { kind in
                    HStack {
                        Text(kind.displayName)
                            .font(.caption.bold())
                        Spacer()

                        let currentAction = eyebrowBindingRegistry.bindings[kind]
                        let actionName = currentAction.map { ActionRegistry.nameFromAction($0) } ?? "none"
                        let binding = Binding<String>(
                            get: { actionName },
                            set: { newName in
                                if newName == "none" {
                                    eyebrowBindingRegistry.removeBinding(kind)
                                } else if let action = ActionRegistry.actionFromName(newName) {
                                    eyebrowBindingRegistry.setBinding(kind, action: action)
                                }
                            }
                        )

                        bindingActionPickerWithNone(selection: binding)
                            .frame(width: 120)
                    }
                }
            } else {
                Text("Left raise → arm voice, left raise again → stop, right raise → send. Override with direct mode above.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Button("Reset Eyebrow Bindings") {
                eyebrowBindingRegistry.resetBindings()
            }
            .controlSize(.small)
            .foregroundStyle(.secondary)
        }
    }
}
