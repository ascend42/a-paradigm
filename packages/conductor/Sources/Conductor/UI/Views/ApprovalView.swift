// ApprovalView.swift — #approval-view
// Notification UI for agent approval requests.
// Shows when an agent sends an approval-request message.
// Conductor responds as Maestro with approve/reject/redirect.

import SwiftUI

struct ApprovalView: View {
    let note: SymphonyNote
    let approvalRequest: ApprovalRequestPayload
    let onDismiss: () -> Void

    @State private var feedback = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack {
                Image(systemName: "bell.badge.fill")
                    .foregroundStyle(.orange)
                Text("Approval Requested")
                    .font(.headline)
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
            }

            Divider()

            // From
            HStack {
                Text("From:")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Text(note.sender.name)
                    .font(.caption)
            }

            // Task
            if let taskId = approvalRequest.taskId.isEmpty ? nil : approvalRequest.taskId {
                HStack {
                    Text("Task:")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    Text(taskId)
                        .font(.caption.monospaced())
                }
            }

            // Summary
            VStack(alignment: .leading, spacing: 2) {
                Text("Summary:")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Text(approvalRequest.summary)
                    .font(.caption)
                    .textSelection(.enabled)
            }

            // Files modified
            if !approvalRequest.filesModified.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Files modified:")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    ForEach(approvalRequest.filesModified, id: \.self) { file in
                        Text("  \(file)")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.primary)
                    }
                }
            }

            // Diff preview
            if let diff = approvalRequest.diff {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Diff:")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    ScrollView {
                        Text(diff)
                            .font(.system(size: 9, design: .monospaced))
                            .textSelection(.enabled)
                    }
                    .frame(maxHeight: 150)
                    .padding(4)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.black.opacity(0.05))
                    )
                }
            }

            // Question
            HStack {
                Text("Question:")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Text(approvalRequest.question)
                    .font(.caption)
                    .italic()
            }

            // Feedback field
            TextField("Optional feedback...", text: $feedback)
                .textFieldStyle(.roundedBorder)
                .font(.caption)

            // Action buttons
            HStack(spacing: 8) {
                Spacer()

                Button("Reject") {
                    respond(decision: .rejected)
                }
                .controlSize(.small)
                .buttonStyle(.bordered)
                .tint(.red)

                Button("Redirect + Feedback") {
                    respond(decision: .redirected)
                }
                .controlSize(.small)
                .buttonStyle(.bordered)
                .disabled(feedback.isEmpty)

                Button("Approve") {
                    respond(decision: .approved)
                }
                .controlSize(.small)
                .buttonStyle(.borderedProminent)
                .tint(.green)
            }
        }
        .padding()
        .frame(width: 440)
    }

    // MARK: - Respond

    private func respond(decision: ApprovalDecision) {
        let responsePayload = ApprovalResponsePayload(
            taskId: approvalRequest.taskId,
            decision: decision,
            feedback: feedback.isEmpty ? nil : feedback
        )

        let sender = Participant(
            id: "conductor/maestro",
            name: "Maestro",
            type: .human
        )

        let responseNote = SymphonyNote(
            id: "cond-appr-\(UUID().uuidString.prefix(8))",
            threadRoot: note.threadRoot,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            sender: sender,
            recipients: [note.sender],
            intent: .approvalResponse,
            content: MessageContent(
                text: "**\(decision.rawValue.capitalized)**: \(feedback.isEmpty ? "No additional feedback." : feedback)"
            ),
            symbols: [],
            metadata: MessageMetadata(approvalResponse: responsePayload)
        )

        // Send to the requesting agent
        ScoreIO.appendJsonl(responseNote, to: ScoreIO.inboxPath(for: note.sender.id))

        ConductorLog.signal("approval-responded")
            .info("Maestro \(decision.rawValue) task \(approvalRequest.taskId)")

        onDismiss()
    }
}

// MARK: - Approval Notification Badge

/// Scans monitor for pending approval-request notes and surfaces them.
struct ApprovalNotificationBanner: View {
    @ObservedObject var monitor: SymphonyMonitor

    @State private var selectedApproval: (note: SymphonyNote, payload: ApprovalRequestPayload)?

    private var pendingApprovals: [(note: SymphonyNote, payload: ApprovalRequestPayload)] {
        var results: [(SymphonyNote, ApprovalRequestPayload)] = []
        for (_, messages) in monitor.threadMessages {
            for note in messages {
                if note.intent == .approvalRequest,
                   let payload = note.metadata?.approvalRequest {
                    results.append((note, payload))
                }
            }
        }
        return results
    }

    var body: some View {
        if !pendingApprovals.isEmpty {
            VStack(spacing: 4) {
                ForEach(pendingApprovals, id: \.note.id) { item in
                    Button(action: {
                        selectedApproval = item
                    }) {
                        HStack(spacing: 6) {
                            Image(systemName: "bell.badge.fill")
                                .foregroundStyle(.orange)
                                .font(.caption)
                            Text("Approval: \(item.payload.question)")
                                .font(.caption)
                                .lineLimit(1)
                            Spacer()
                            Text(item.note.sender.name)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            RoundedRectangle(cornerRadius: 6)
                                .fill(Color.orange.opacity(0.1))
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .sheet(item: Binding(
                get: { selectedApproval?.note.id },
                set: { if $0 == nil { selectedApproval = nil } }
            )) { _ in
                if let approval = selectedApproval {
                    ApprovalView(
                        note: approval.note,
                        approvalRequest: approval.payload,
                        onDismiss: { selectedApproval = nil }
                    )
                }
            }
        }
    }
}
