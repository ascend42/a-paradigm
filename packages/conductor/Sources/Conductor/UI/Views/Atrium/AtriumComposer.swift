// AtriumComposer.swift — #atrium-thread
// Reply composer pinned to the bottom of the ATRIUM thread.
//
// ROBUSTNESS CONTRACT (founder-unblock): the reply field is NEVER hard-disabled
// by session status. Typing is always allowed and always focusable, so the user
// can never get permanently locked out by a stuck-running session. The headless
// `claude --input-format stream-json` process queues the next user turn over
// stdin, so sending while a turn is in flight is safe. Send is gated only on
// "there is a live session" + "the field is non-empty" — never on .running.

import SwiftUI

struct AtriumComposer: View {
    @ObservedObject var session: ClaudeStreamSession
    @State private var draft = ""
    /// Keyboard focus for the reply field. Auto-focused on appear and after each
    /// turn completes so an LSUIElement (accessory) app's programmatic window
    /// routes typing into the field without an extra click.
    @FocusState private var fieldFocused: Bool

    /// The agent is mid-turn. Used ONLY for the subtle "thinking" affordance on
    /// the Send button — it must NEVER disable the text field.
    private var isBusy: Bool { session.status == .running || session.status == .starting }

    /// A live session is one we can still write a turn into (not torn down).
    private var sessionIsLive: Bool {
        session.status != .stopped && session.status != .error
    }

    /// Send is enabled whenever the session is live and the draft is non-empty.
    /// Decoupled from .running — sending mid-turn queues the turn on claude's stdin.
    private var canSend: Bool {
        sessionIsLive && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

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
                // NOTE: intentionally NOT .disabled(isBusy). The field stays
                // editable at all times so a stuck/slow turn can never lock the
                // founder out. See ROBUSTNESS CONTRACT above.
                .focused($fieldFocused)
                .onSubmit(submit)
                .onAppear { focusAfterDelay() }
                .onChange(of: isBusy) { _, busy in
                    // When the agent finishes a turn, return focus to the field.
                    if !busy { focusAfterDelay() }
                }

            Button(action: submit) {
                Text(isBusy ? "Send →" : "Send")
                    .font(AtriumTheme.chipFont)
                    .foregroundColor(AtriumTheme.void)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(canSend ? AtriumTheme.amber : AtriumTheme.inkMuted)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(12)
        .background(AtriumTheme.surface)
    }

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        // Gate ONLY on non-empty + live session — never on .running. A mid-turn
        // send is queued by claude over stdin.
        guard !text.isEmpty, sessionIsLive else { return }
        session.send(text: text)
        draft = ""
        // Keep focus so the founder can keep typing immediately.
        focusAfterDelay()
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
