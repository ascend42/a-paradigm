// CustomGestureBindingsView.swift — #custom-gesture-bindings
// Extracted from BindingsManagerView — custom gesture template management.

import SwiftUI

struct CustomGestureBindingsView: View {
    @ObservedObject var customGestureClassifier: CustomGestureClassifier
    @Binding var showGestureRecorder: Bool

    var body: some View {
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
    }
}
