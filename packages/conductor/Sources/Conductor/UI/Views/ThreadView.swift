// ThreadView.swift — #thread-view
// Chat-like Symphony thread viewer with message compose.
// Conductor can send messages into threads on behalf of the human.

import SwiftUI

struct ThreadView: View {
    let threadId: String
    @ObservedObject var monitor: SymphonyMonitor
    @ObservedObject var relay: NoteRelay
    let agentPartManager: AgentPartManager

    @State private var messageText = ""
    @Environment(\.dismiss) private var dismiss

    private var messages: [SymphonyNote] {
        monitor.getThread(threadId: threadId)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "bubble.left.and.bubble.right")
                    .foregroundStyle(.purple)
                Text(threadId)
                    .font(.caption.bold())
                    .lineLimit(1)
                Spacer()
                Text("\(messages.count) messages")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Button(action: { dismiss() }) {
                    Image(systemName: "xmark.circle")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)

            Divider()

            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(messages) { note in
                            messageBubble(note)
                                .id(note.id)
                        }
                    }
                    .padding(8)
                }
                .onChange(of: messages.count) { _ in
                    if let lastId = messages.last?.id {
                        withAnimation {
                            proxy.scrollTo(lastId, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            // Compose
            HStack(spacing: 6) {
                TextField("Message...", text: $messageText)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
                    .onSubmit { sendMessage() }

                Button("Send") { sendMessage() }
                    .controlSize(.small)
                    .buttonStyle(.borderedProminent)
                    .disabled(messageText.isEmpty)
            }
            .padding(8)
        }
        .frame(minWidth: 280, minHeight: 300)
    }

    // MARK: - Message Bubble

    private func messageBubble(_ note: SymphonyNote) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            // Sender + timestamp
            HStack {
                Text(note.sender.name)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.primary)
                Spacer()
                Text(relativeTime(note.timestamp))
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
            }

            // Intent badge
            HStack(spacing: 4) {
                Text(note.intent.rawValue)
                    .font(.system(size: 8, weight: .medium))
                    .foregroundStyle(intentColor(note.intent))
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(
                        Capsule().fill(intentColor(note.intent).opacity(0.15))
                    )

                if !note.symbols.isEmpty {
                    Text(note.symbols.joined(separator: " "))
                        .font(.system(size: 8))
                        .foregroundStyle(.tertiary)
                }
            }

            // Content
            Text(note.content.text)
                .font(.caption)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)

            // Diff (if present)
            if let diff = note.content.diff {
                Text(diff)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(4)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.black.opacity(0.05))
                    )
                    .lineLimit(10)
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
    }

    // MARK: - Send

    private func sendMessage() {
        guard !messageText.isEmpty else { return }

        let sender = Participant(
            id: "conductor/maestro",
            name: "Maestro",
            type: .human
        )

        let note = SymphonyNote(
            id: "cond-\(UUID().uuidString.prefix(8))",
            threadRoot: threadId,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            sender: sender,
            intent: .context,
            content: MessageContent(text: messageText),
            symbols: []
        )

        // Write to all agents in the thread
        let threadAgentIds = Set(messages.map(\.sender.id))
        for agentId in threadAgentIds {
            ScoreIO.appendJsonl(note, to: ScoreIO.inboxPath(for: agentId))
        }

        messageText = ""

        ConductorLog.component("thread-view")
            .info("Maestro sent message to thread \(self.threadId)")
    }

    // MARK: - Helpers

    private func intentColor(_ intent: MessageIntent) -> Color {
        switch intent {
        case .question: return .blue
        case .context, .clarification: return .cyan
        case .proposal: return .orange
        case .verification: return .purple
        case .action: return .green
        case .decision: return .yellow
        case .alert: return .red
        case .approval: return .green
        case .rejection: return .red
        case .reference: return .gray
        case .handoff: return .orange
        case .fileRequest, .fileApproved, .fileDenied, .fileDelivery: return .indigo
        }
    }

    private func relativeTime(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: isoString) else { return "" }
        let interval = Date().timeIntervalSince(date)

        if interval < 60 { return "now" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86400 { return "\(Int(interval / 3600))h ago" }
        return "\(Int(interval / 86400))d ago"
    }
}
