// GestureRecorderView.swift — #gesture-recorder
// Full-screen overlay for recording custom gestures.
// Shows progress, hand skeleton visualization, name input, action picker.

import SwiftUI

struct GestureRecorderView: View {
    @ObservedObject var recorder: GestureRecorder
    @State private var gestureName: String = ""
    @State private var selectedAction: String = "send"
    let onComplete: (GestureTemplate?) -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            // Header
            Text("Record Custom Gesture")
                .font(.title.bold())

            Text("Perform the same gesture \(recorder.requiredSamples) times")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Spacer()

            // Status
            VStack(spacing: 16) {
                // Progress
                HStack(spacing: 8) {
                    ForEach(0..<recorder.requiredSamples, id: \.self) { i in
                        Circle()
                            .fill(i < recorder.recordedSamples ? ConductorTheme.healthy : Color.secondary.opacity(0.3))
                            .frame(width: 16, height: 16)
                            .overlay(
                                i < recorder.recordedSamples
                                ? Image(systemName: "checkmark").font(.caption2).foregroundStyle(.white)
                                : nil
                            )
                    }
                }

                switch recorder.state {
                case .idle:
                    Button("Record Sample \(recorder.recordedSamples + 1)") {
                        recorder.startRecording()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                case .recording(let sample):
                    VStack(spacing: 8) {
                        ProgressView()
                        Text("Recording sample \(sample)...")
                            .font(.subheadline)
                            .foregroundStyle(ConductorTheme.warning)
                        Button("Stop") {
                            recorder.stopRecording()
                        }
                        .buttonStyle(.bordered)
                    }

                case .processing:
                    finalizationForm

                case .complete:
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(ConductorTheme.healthy)
                    Text("Gesture recorded!")
                        .font(.headline)
                }
            }

            Spacer()

            // Bottom actions
            HStack {
                Button("Cancel") {
                    onCancel()
                }
                .keyboardShortcut(.cancelAction)

                Spacer()

                if recorder.recordedSamples > 0 && recorder.state == .idle {
                    Button("Reset") {
                        recorder.reset()
                    }
                }
            }
            .padding(.horizontal, 40)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.ultraThinMaterial)
    }

    // MARK: - Finalization Form

    private var finalizationForm: some View {
        VStack(spacing: 16) {
            TextField("Gesture name", text: $gestureName)
                .textFieldStyle(.roundedBorder)
                .frame(width: 250)

            Picker("Bind to action", selection: $selectedAction) {
                Text("Send").tag("send")
                Text("Undo").tag("undo")
                Text("Redo").tag("redo")
                Text("Voice Start").tag("voiceStart")
                Text("Voice Stop").tag("voiceStop")
                Text("Delete Char").tag("deleteChar")
                Text("Delete Word").tag("deleteWord")
            }
            .frame(width: 250)

            Button("Save Gesture") {
                let template = recorder.buildTemplate(
                    name: gestureName,
                    action: selectedAction
                )
                onComplete(template)
            }
            .buttonStyle(.borderedProminent)
            .disabled(gestureName.isEmpty)
        }
    }
}
