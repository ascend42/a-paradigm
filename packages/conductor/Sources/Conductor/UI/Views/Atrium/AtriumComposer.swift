// AtriumComposer.swift — #atrium-thread
// Reply composer pinned to the bottom of the ATRIUM thread.
//
// ROBUSTNESS CONTRACT (founder-unblock): the reply field is NEVER hard-disabled
// by session status. Typing is always allowed and always focusable, so the user
// can never get permanently locked out by a stuck-running session. The headless
// `claude --input-format stream-json` process queues the next user turn over
// stdin, so sending while a turn is in flight is safe. Send is gated only on
// "there is a live session" + "the field is non-empty" — never on .running.
//
// CAPABILITIES:
//   B — Multiline input: Return submits, Shift+Return inserts a newline, the
//       field grows to ~6 lines then scrolls. (#atrium-thread)
//   C — Drag-in files → removable attachment chips (#atrium-attachment). Paths
//       are appended to the outgoing turn text so the agent can Read them; the
//       visible draft stays clean.
//   D — Voice activation (#atrium-voice): a mic affordance drives a keyword
//       dictation loop that streams transcript into the draft.

import SwiftUI
import UniformTypeIdentifiers

struct AtriumComposer: View {
    @ObservedObject var session: ClaudeStreamSession
    @State private var draft = ""
    /// Files dragged onto the composer — shown as chips, conveyed on send.
    @State private var attachments: [URL] = []
    /// Drag-hover highlight.
    @State private var isDropTargeted = false
    /// Keyword-driven voice dictation controller (Feature D).
    @StateObject private var voice = AtriumVoiceController()

    /// Keyboard focus for the reply field. Auto-focused on appear and after each
    /// turn completes so an LSUIElement (accessory) app's programmatic window
    /// routes typing into the field without an extra click.
    @FocusState private var fieldFocused: Bool

    /// Cap the visual growth of the multiline field (~6 lines) before scrolling.
    private let maxVisibleLines = 6

    /// The agent is mid-turn. Used ONLY for the subtle "thinking" affordance on
    /// the Send button — it must NEVER disable the text field.
    private var isBusy: Bool { session.status == .running || session.status == .starting }

    /// A live session is one we can still write a turn into (not torn down).
    private var sessionIsLive: Bool {
        session.status != .stopped && session.status != .error
    }

    /// Send is enabled whenever the session is live and there is something to
    /// send (draft text OR attachments). Decoupled from .running — sending
    /// mid-turn queues the turn on claude's stdin.
    private var canSend: Bool {
        guard sessionIsLive else { return false }
        let hasText = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return hasText || !attachments.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Attachment chips row (Feature C) — only when present.
            if !attachments.isEmpty {
                attachmentRow
            }

            HStack(alignment: .bottom, spacing: 8) {
                voiceButton
                composerField
                sendButton
            }
        }
        .padding(12)
        .background(AtriumTheme.surface)
        .overlay(
            // Drop-target highlight (Feature C).
            RoundedRectangle(cornerRadius: 8)
                .stroke(isDropTargeted ? AtriumTheme.tool : Color.clear, lineWidth: 1.5)
        )
        .onDrop(of: [.fileURL], isTargeted: $isDropTargeted) { providers in
            handleDrop(providers)
        }
        .onAppear { focusAfterDelay() }
        .onChange(of: isBusy) { _, busy in
            // When the agent finishes a turn, return focus to the field.
            if !busy { focusAfterDelay() }
        }
        .onAppear { wireVoice() }
    }

    // MARK: - Subviews

    private var attachmentRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(attachments, id: \.self) { url in
                    AtriumAttachmentChip(url: url) {
                        attachments.removeAll { $0 == url }
                    }
                }
            }
        }
    }

    private var composerField: some View {
        // TextField with `.vertical` axis is multiline on macOS 14. lineLimit
        // gives the grow-to-cap-then-scroll behavior. .onKeyPress(.return)
        // distinguishes Shift+Return (newline) from Return (submit).
        TextField("Reply…", text: $draft, axis: .vertical)
            .textFieldStyle(.plain)
            .lineLimit(1...maxVisibleLines)
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
            // NOTE: intentionally NOT .disabled(isBusy). The field stays editable
            // at all times so a stuck/slow turn can never lock the founder out.
            .focused($fieldFocused)
            .onKeyPress(.return) {
                // Shift+Return → allow the newline to be inserted by the field.
                if NSEvent.modifierFlags.contains(.shift) {
                    return .ignored
                }
                // Plain Return → submit.
                submit()
                return .handled
            }
    }

    private var sendButton: some View {
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

    // Voice mic affordance (Feature D). Color reflects state: amber when active.
    private var voiceButton: some View {
        Button(action: { voice.toggle() }) {
            Image(systemName: voiceSymbol)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(voiceTint)
                .frame(width: 36, height: 38)
                .background(AtriumTheme.surfaceRaised)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(voice.state == .off ? AtriumTheme.hairline : voiceTint, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .help(voiceHelp)
    }

    private var voiceSymbol: String {
        switch voice.state {
        case .off: return "mic.slash"
        case .armed: return "mic"
        case .composing: return "waveform"
        case .sending: return "paperplane.fill"
        }
    }

    private var voiceTint: Color {
        switch voice.state {
        case .off: return AtriumTheme.inkMuted
        case .armed: return AtriumTheme.user
        case .composing: return AtriumTheme.amber
        case .sending: return AtriumTheme.running
        }
    }

    private var voiceHelp: String {
        switch voice.state {
        case .off: return "Click to listen. Say \"\(AtriumVoiceController.wakeKeyword)\" to start dictating."
        case .armed: return "Listening… say \"\(AtriumVoiceController.wakeKeyword)\" to dictate."
        case .composing: return "Dictating. Say \"\(AtriumVoiceController.sendKeyword)\" to send, \"scratch that\" to clear."
        case .sending: return "Sending…"
        }
    }

    // MARK: - Voice wiring

    private func wireVoice() {
        voice.onDraftAppend = { fragment in
            let trimmed = fragment.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            if draft.isEmpty {
                draft = trimmed
            } else {
                draft += " " + trimmed
            }
        }
        voice.onDraftClear = { draft = "" }
        voice.onSubmit = { submit() }
    }

    // MARK: - Drop handling (Feature C)

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        var accepted = false
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            accepted = true
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                guard let url, url.isFileURL else { return }
                Task { @MainActor in
                    if !attachments.contains(url) {
                        attachments.append(url)
                    }
                }
            }
        }
        return accepted
    }

    // MARK: - Submit

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        // Gate ONLY on (non-empty OR has attachments) + live session — never on
        // .running. A mid-turn send is queued by claude over stdin.
        guard sessionIsLive else { return }
        guard !text.isEmpty || !attachments.isEmpty else { return }

        let outgoing = composeOutgoingTurn(visibleText: text)
        session.send(text: outgoing)

        draft = ""
        attachments = []
        // Keep focus so the founder can keep typing immediately.
        focusAfterDelay()
    }

    /// Build the turn the agent receives. The visible draft stays clean (chips,
    /// not paths); attachment absolute paths are appended as a trailing block so
    /// the `claude -p` text engine can Read them.
    private func composeOutgoingTurn(visibleText: String) -> String {
        guard !attachments.isEmpty else { return visibleText }
        let paths = attachments.map(\.path).joined(separator: "\n")
        let prefix = visibleText.isEmpty ? "" : visibleText + "\n\n"
        return prefix + "Attached files:\n" + paths
    }

    // MARK: - Focus

    /// Move keyboard focus to the field on the next runloop tick. A bare
    /// `fieldFocused = true` inside onAppear races the window becoming key in an
    /// accessory app, so it is nudged after a short delay.
    private func focusAfterDelay() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            fieldFocused = true
        }
    }
}
