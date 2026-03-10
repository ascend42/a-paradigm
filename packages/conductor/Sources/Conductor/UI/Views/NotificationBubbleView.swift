// NotificationBubbleView.swift — #notification-bubble
// Per-instance status bubble overlay near the title bar.

import SwiftUI

struct NotificationBubbleView: View {
    let instance: ClaudeCodeInstance
    let status: InstanceStatus
    let agentCount: Int

    var body: some View {
        HStack(spacing: 6) {
            statusIcon
            statusText
            if agentCount > 0 {
                agentBadge
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            Capsule()
                .fill(.ultraThinMaterial)
                .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
        )
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch status {
        case .idle:
            Image(systemName: "moon.fill")
                .foregroundStyle(.gray)
                .font(.caption2)
        case .processing:
            ProgressView()
                .controlSize(.mini)
        case .finished:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.caption2)
        case .unknown:
            Image(systemName: "questionmark.circle")
                .foregroundStyle(.gray)
                .font(.caption2)
        }
    }

    private var statusText: some View {
        Text(status.rawValue.capitalized)
            .font(.caption2)
            .foregroundStyle(.secondary)
    }

    private var agentBadge: some View {
        HStack(spacing: 2) {
            Image(systemName: "person.2.fill")
                .font(.system(size: 8))
            Text("\(agentCount)")
                .font(.caption2.bold())
        }
        .foregroundStyle(.purple)
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(
            Capsule()
                .fill(Color.purple.opacity(0.15))
        )
    }
}
