// HotkeyBindingsView.swift — #hotkey-bindings-view
// Extracted from BindingsManagerView — hotkey binding management with recorder.

import SwiftUI

struct HotkeyBindingsView: View {
    var hotKeyBindingRegistry: HotKeyBindingRegistry

    @State private var isRecordingHotKey = false
    @State private var pendingHotKeyAction = "send"

    var body: some View {
        Section("Hotkey Bindings") {
            ForEach(Array(hotKeyBindingRegistry.bindings.keys.sorted(by: { $0.description < $1.description })), id: \.self) { binding in
                if let action = hotKeyBindingRegistry.bindings[binding] {
                    HStack {
                        Text(binding.description)
                            .font(.system(size: 11, design: .monospaced))
                        Spacer()
                        Text(ActionRegistry.nameFromAction(action))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Button(action: {
                            hotKeyBindingRegistry.removeBinding(binding)
                        }) {
                            Image(systemName: "minus.circle")
                                .foregroundStyle(.red)
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }

            // Add new hotkey
            HStack(spacing: 8) {
                HotKeyRecorder(isRecording: $isRecordingHotKey) { binding in
                    if let action = ActionRegistry.actionFromName(pendingHotKeyAction) {
                        hotKeyBindingRegistry.setBinding(binding, action: action)
                    }
                }
                .frame(width: 140, height: 24)

                bindingActionPicker(selection: $pendingHotKeyAction)
                    .frame(width: 100)
            }

            Button("Reset to Defaults") {
                hotKeyBindingRegistry.resetToDefaults()
            }
            .controlSize(.small)
            .foregroundStyle(.secondary)
        }
    }
}
