// ThreadListView.swift — #thread-list-view
// Shows active Symphony threads in the overlay sidebar.

import SwiftUI

struct ThreadListView: View {
    @ObservedObject var relay: NoteRelay

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: "music.quarternote.3")
                    .foregroundStyle(ConductorTheme.symphony)
                Text("Threads")
                    .font(.caption.bold())
                Spacer()
                Text("\(relay.activeThreads.count)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if relay.activeThreads.isEmpty {
                Text("No active threads")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 4)
            } else {
                ForEach(relay.activeThreads) { thread in
                    threadRow(thread)
                }
            }
        }
    }

    private func threadRow(_ thread: ThreadMeta) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(thread.status == .active ? ConductorTheme.healthy : Color.gray)
                .frame(width: 6, height: 6)
                .accessibilityLabel(thread.status == .active ? "Active" : "Inactive")

            VStack(alignment: .leading, spacing: 1) {
                Text(thread.topic)
                    .font(.caption)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    Text("\(thread.participants.count) participants")
                    Text("\(thread.messageCount) notes")
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            Spacer()

            Text(relativeTime(thread.lastActivity))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }

    private func relativeTime(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: isoString) else { return "" }
        let interval = Date().timeIntervalSince(date)

        if interval < 60 { return "now" }
        if interval < 3600 { return "\(Int(interval / 60))m" }
        if interval < 86400 { return "\(Int(interval / 3600))h" }
        return "\(Int(interval / 86400))d"
    }
}
