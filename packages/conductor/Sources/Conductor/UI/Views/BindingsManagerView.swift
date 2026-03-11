// BindingsManagerView.swift — #bindings-manager
// Settings tab for managing all input→action bindings.
// Three sections: Gesture Bindings, Voice Commands, Eyebrow Bindings.

import SwiftUI

struct BindingsManagerView: View {
    @ObservedObject var actionRegistry: ActionRegistry
    @ObservedObject var voiceCommandRegistry: VoiceCommandRegistry
    @ObservedObject var customGestureClassifier: CustomGestureClassifier

    @State private var showGestureRecorder = false
    @State private var newVoicePhrase = ""
    @State private var newVoiceAction = "send"

    var body: some View {
        Form {
            // MARK: - Custom Gestures

            Section("Custom Gestures") {
                if customGestureClassifier.registeredTemplates.isEmpty {
                    Text("No custom gestures recorded")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                } else {
                    ForEach(customGestureClassifier.registeredTemplates) { template in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(template.name)
                                    .font(.caption.bold())
                                Text(template.boundAction)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(template.recordingCount) samples")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                            Button(action: {
                                customGestureClassifier.removeTemplate(id: template.id)
                                template.delete()
                            }) {
                                Image(systemName: "trash")
                                    .foregroundStyle(.red)
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }

                Button("Record New Gesture\u{2026}") {
                    showGestureRecorder = true
                }
                .controlSize(.small)
                .disabled(customGestureClassifier.registeredTemplates.count >= CustomGestureClassifier.maxTemplates)

                if customGestureClassifier.registeredTemplates.count >= CustomGestureClassifier.maxTemplates {
                    Text("Maximum \(CustomGestureClassifier.maxTemplates) gestures reached")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }

            // MARK: - Voice Commands

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

                    Picker("", selection: $newVoiceAction) {
                        Text("Send").tag("send")
                        Text("Undo").tag("undo")
                        Text("Redo").tag("redo")
                        Text("Voice Start").tag("voiceStart")
                        Text("Voice Stop").tag("voiceStop")
                        Text("Toggle Video").tag("toggleVideo")
                        Text("Toggle Voice").tag("toggleVoice")
                        Text("Mute Video").tag("muteVideo")
                        Text("Mute Voice").tag("muteVoice")
                    }
                    .labelsHidden()
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

            // MARK: - Built-in Gesture Overrides

            Section("Built-in Gestures") {
                Text("Pinch → Delete, Fist → Undo, Open → Redo, Two-finger → Send")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("Custom overrides coming in a future update.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}
