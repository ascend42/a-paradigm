// AtriumComposer.swift — #atrium-thread
// Reply composer pinned to the bottom of the ATRIUM thread. Disabled while the
// agent is mid-turn. Submits on Enter or the Send button.

import SwiftUI

struct AtriumComposer: View {
    @ObservedObject var session: ClaudeStreamSession
    @State private var draft = ""
    /// Keyboard focus for the reply field. Auto-focused on appear and after each
    /// turn completes so an LSUIElement (accessory) app's programmatic window
    /// routes typing into the field without an extra click.
    @FocusState private var fieldFocused: Bool

    private var isBusy: Bool { session.status == .running || session.status == .starting }

    var body: some View {
        HStack(spacing: 8) {
            TextField("Reply…", text: $draft)
                .textFieldStyle(.plain)
                .font(AtriumTheme.bodyFont)
                .foregroundColor(AtriumTheme.ink)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(AtriumTheme.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(AtriumTheme.hairline, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .disabled(isBusy)
                .focused($fieldFocused)
                .onSubmit(submit)
                .onAppear { focusAfterDelay() }
                .onChange(of: isBusy) { _, busy in
                    // When the agent finishes a turn, return focus to the field.
                    if !busy { focusAfterDelay() }
                }

            Button(action: submit) {
                Text("Send")
                    .font(AtriumTheme.chipFont)
                    .foregroundColor(AtriumTheme.void)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(isBusy ? AtriumTheme.inkMuted : AtriumTheme.amber)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .disabled(isBusy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(12)
        .background(AtriumTheme.surface)
    }

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isBusy else { return }
        session.send(text: text)
        draft = ""
    }

    /// Move keyboard focus to the field on the next runloop tick. A bare
    /// `fieldFocused = true` inside onAppear races the window becoming key in an
    /// accessory app, so it is nudged after a short delay.
    private func focusAfterDelay() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            fieldFocused = true
        }
    }
}
