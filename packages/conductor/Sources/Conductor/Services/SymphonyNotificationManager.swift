// SymphonyNotificationManager.swift — #symphony-notifications
// Surfaces notifications for new Symphony messages based on intent priority.
// Banner = interrupting (alerts, tasks). Toast = non-interrupting (proposals, questions).
// Silent = badge-only (clarifications, progress).

import Foundation

/// Priority level for Symphony message notifications.
enum SymphonyNotificationPriority {
    case banner   // Shows overlay banner — alerts, approval-requests, pan-invoke, task
    case toast    // Brief toast — questions, proposals, decisions, context
    case silent   // Badge increment only — clarifications, references, progress
}

/// A pending notification for display by the UI layer.
struct SymphonyNotification: Identifiable {
    let id: String
    let priority: SymphonyNotificationPriority
    let threadId: String
    let senderName: String
    let senderProject: String?
    let intent: MessageIntent
    let preview: String  // First ~100 chars of message text
    let timestamp: Date
}

/// Manages Symphony message notifications across all threads.
@MainActor
final class SymphonyNotificationManager: ObservableObject {

    /// Pending notifications for UI display (most recent first).
    @Published var pending: [SymphonyNotification] = []

    /// Unread badge count (all priorities).
    @Published var unreadCount: Int = 0

    /// IDs of notes already notified to avoid duplicates.
    private var notifiedIds: Set<String> = []

    /// Maximum pending notifications before oldest are pruned.
    private let maxPending = 20

    // MARK: - Process New Notes

    /// Check a batch of notes and generate notifications for new ones.
    func processNotes(_ notes: [SymphonyNote]) {
        for note in notes {
            guard !notifiedIds.contains(note.id) else { continue }
            notifiedIds.insert(note.id)

            let priority = priorityForIntent(note.intent)
            // Silent notes only increment badge, no visible notification
            if priority == .silent {
                unreadCount += 1
                continue
            }

            let preview = String(note.content.text.prefix(120))
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let date = formatter.date(from: note.timestamp) ?? Date()

            let notification = SymphonyNotification(
                id: note.id,
                priority: priority,
                threadId: note.threadRoot ?? note.id,
                senderName: note.sender.name,
                senderProject: note.sender.project,
                intent: note.intent,
                preview: preview,
                timestamp: date
            )

            pending.insert(notification, at: 0)
            unreadCount += 1

            // Prune old notifications
            if pending.count > maxPending {
                pending = Array(pending.prefix(maxPending))
            }
        }
    }

    /// Dismiss a specific notification.
    func dismiss(_ id: String) {
        pending.removeAll { $0.id == id }
    }

    /// Clear all notifications and reset badge.
    func clearAll() {
        pending.removeAll()
        unreadCount = 0
    }

    /// Mark all as read (reset badge, keep notifications visible).
    func markAllRead() {
        unreadCount = 0
    }

    // MARK: - Intent Priority Mapping

    private func priorityForIntent(_ intent: MessageIntent) -> SymphonyNotificationPriority {
        switch intent {
        case .alert, .approvalRequest, .panInvoke, .task:
            return .banner
        case .question, .proposal, .decision, .context, .action:
            return .toast
        default:
            return .silent
        }
    }
}
