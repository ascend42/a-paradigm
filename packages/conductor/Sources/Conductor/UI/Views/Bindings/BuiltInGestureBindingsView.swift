// BuiltInGestureBindingsView.swift — #builtin-gesture-bindings
// Extracted from BindingsManagerView — built-in gesture override management.

import SwiftUI

struct BuiltInGestureBindingsView: View {
    @ObservedObject var actionRegistry: ActionRegistry

    var body: some View {
        Section("Built-in Gestures") {
            let gestureNames = ["pinch", "fist", "open_after_fist", "twoFingerTap", "swipeLeft", "swipeRight"]
            ForEach(gestureNames, id: \.self) { gestureName in
                HStack {
                    Text(gestureDisplayName(gestureName))
                        .font(.caption.bold())
                    Spacer()

                    let currentAction = actionRegistry.gestureBindings[gestureName]
                    let actionName = currentAction.map { ActionRegistry.nameFromAction($0) } ?? "none"
                    let binding = Binding<String>(
                        get: { actionName },
                        set: { newName in
                            if let action = ActionRegistry.actionFromName(newName) {
                                actionRegistry.gestureBindings[gestureName] = action
                                actionRegistry.save()
                            }
                        }
                    )

                    bindingActionPicker(selection: binding)
                        .frame(width: 120)
                }
            }

            Button("Reset to Defaults") {
                actionRegistry.resetToDefaults()
            }
            .controlSize(.small)
            .foregroundStyle(.secondary)
        }
    }
}
