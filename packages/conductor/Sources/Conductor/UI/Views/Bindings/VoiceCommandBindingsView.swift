// VoiceCommandBindingsView.swift — #voice-command-bindings
// Extracted from BindingsManagerView — voice command phrase binding management.

import SwiftUI

struct VoiceCommandBindingsView: View {
    @ObservedObject var voiceCommandRegistry: VoiceCommandRegistry

    @State private var newVoicePhrase = ""
    @State private var newVoiceAction = "send"

    var body: some View {
        Section("Voice Commands") {
            ForEach(Array(voiceCommandRegistry.commands.keys.sorted()), id: \.self) { phrase in
                if let action = voiceCommandRegistry.commands[phrase] {
                    HStack {
                        Text("\"\(phrase)\"")
                            .font(.caption.bold())
                        Spacer()
                        Text(ActionRegistry.nameFromAction(action))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Button(action: {
                            voiceCommandRegistry.removeCommand(phrase: phrase)
                        }) {
                            Image(systemName: "xmark.circle")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }

            // Add new command
            HStack(spacing: 8) {
                TextField("Phrase", text: $newVoicePhrase)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 120)

                bindingActionPicker(selection: $newVoiceAction)
                    .frame(width: 100)

                Button("Add") {
                    if let action = ActionRegistry.actionFromName(newVoiceAction) {
                        voiceCommandRegistry.setCommand(phrase: newVoicePhrase, action: action)
                        newVoicePhrase = ""
                    }
                }
                .disabled(newVoicePhrase.isEmpty)
            }

            Button("Reset to Defaults") {
                voiceCommandRegistry.resetToDefaults()
            }
            .controlSize(.small)
            .foregroundStyle(.secondary)
        }
    }
}
