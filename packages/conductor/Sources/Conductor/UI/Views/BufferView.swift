// BufferView.swift — #buffer-view
// SwiftUI text buffer display with cursor indicator and send button.

import SwiftUI

struct BufferView: View {
    @ObservedObject var buffer: BufferEngine
    @ObservedObject var gazeRouter: GazeRouter
    var gazeZoneRouter: GazeZoneRouter?
    let onSend: () -> Void

    @State private var inputText: String = ""
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Text Buffer", systemImage: "text.cursor")
                .font(.subheadline.bold())
                .foregroundStyle(.secondary)

            // Text input area
            TextEditor(text: $inputText)
                .font(.system(.body, design: .monospaced))
                .scrollContentBackground(.hidden)
                .padding(8)
                .frame(minHeight: 60, maxHeight: 120)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(nsColor: .textBackgroundColor))
                )
                .focused($isInputFocused)
                .onChange(of: inputText) { _, newValue in
                    buffer.replace(with: newValue)
                }
                .onChange(of: buffer.text) { _, newValue in
                    if inputText != newValue {
                        inputText = newValue
                    }
                }

            // Action bar
            HStack {
                // Character count
                Text("\(buffer.text.count) chars")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                Spacer()

                // Undo/Redo
                Button(action: { buffer.undo() }) {
                    Image(systemName: "arrow.uturn.backward")
                }
                .buttonStyle(.borderless)
                .disabled(buffer.isEmpty)

                Button(action: { buffer.redo() }) {
                    Image(systemName: "arrow.uturn.forward")
                }
                .buttonStyle(.borderless)

                // Send button
                Button(action: onSend) {
                    Label("Send", systemImage: "paperplane.fill")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(buffer.isEmpty || gazeRouter.currentTarget == nil)
                .keyboardShortcut(.return, modifiers: .command)
            }

            // Target indicator
            if let zoneRouter = gazeZoneRouter, let managed = zoneRouter.targetedInstance {
                HStack(spacing: 4) {
                    Image(systemName: "target")
                        .foregroundStyle(.green)
                    Text("Will send to: [Cell \(managed.gridIndex + 1)] \(managed.label)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            } else if let target = gazeRouter.currentTarget {
                HStack(spacing: 4) {
                    Image(systemName: "target")
                        .foregroundStyle(.green)
                    Text("Target: \(target.title)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            } else {
                HStack(spacing: 4) {
                    Image(systemName: "target")
                        .foregroundStyle(.orange)
                    Text("No target — select an instance below")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
