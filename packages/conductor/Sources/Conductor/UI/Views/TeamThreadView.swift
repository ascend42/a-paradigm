// TeamThreadView.swift — #team-thread-view
// Chat-style display of Maestro orchestration team threads.
// Shows agent contributions as attributed messages with colored role prefixes.

import SwiftUI

struct TeamThreadView: View {
    @ObservedObject var threadWatcher: SymphonyThreadWatcher
    @ObservedObject var monitor: SymphonyMonitor
    @State private var selectedThread: String?
    @State private var isCollapsed = false

    // Agent color palette — deterministic by role name
    private static let agentColors: [Color] = [
        .blue, .purple, .orange, .green, .cyan, .pink, .mint, .indigo
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            headerRow
            if !isCollapsed {
                if let threadId = selectedThread ?? threadWatcher.activeThreadIds.first {
                    threadContent(threadId: threadId)
                } else {
                    emptyState
                }
            }
        }
    }

    // MARK: - Header

    private var headerRow: some View {
        HStack(spacing: 6) {
            Image(systemName: "person.3.fill")
                .foregroundStyle(ConductorTheme.symphony)
                .font(.caption)

            Text("Team Thread")
                .font(.caption.bold())

            if threadWatcher.totalMessageCount > 0 {
                Text("\(threadWatcher.totalMessageCount)")
                    .font(.system(size: ConductorTheme.fontXS, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(ConductorTheme.symphony))
            }

            Spacer()

            // Thread picker if multiple threads
            if threadWatcher.activeThreadIds.count > 1 {
                Menu {
                    ForEach(threadWatcher.activeThreadIds, id: \.self) { threadId in
                        Button(threadWatcher.threadDisplayName(threadId)) {
                            selectedThread = threadId
                        }
                    }
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: ConductorTheme.fontXS))
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
            }

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isCollapsed.toggle()
                }
            } label: {
                Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                    .font(.system(size: ConductorTheme.fontXS))
                    .foregroundStyle(.tertiary)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Thread Content

    private func threadContent(threadId: String) -> some View {
        let messages = threadWatcher.teamThreads[threadId] ?? []

        return VStack(alignment: .leading, spacing: 4) {
            // Thread title with project badge
            HStack(spacing: 4) {
                Circle()
                    .fill(ConductorTheme.healthy)
                    .frame(width: 6, height: 6)
                    .accessibilityLabel("Active thread")

                // Project origin badge (cross-session visibility)
                if let project = threadWatcher.threadProject(threadId) {
                    Text(project)
                        .font(.system(size: 9, weight: .semibold))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(projectBadgeColor(project).opacity(0.2))
                        .foregroundStyle(projectBadgeColor(project))
                        .cornerRadius(3)
                }

                Text(threadWatcher.threadDisplayName(threadId))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text("·")
                    .foregroundStyle(.tertiary)
                Text("\(messages.count) messages")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            // Messages
            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        ForEach(messages) { note in
                            TeamMessageBubble(
                                note: note,
                                color: agentColor(for: note.sender.role ?? note.sender.name)
                            )
                            .id(note.id)
                        }
                    }
                }
                .frame(maxHeight: 200)
                .onChange(of: messages.count) {
                    if let lastId = messages.last?.id {
                        withAnimation {
                            proxy.scrollTo(lastId, anchor: .bottom)
                        }
                    }
                }
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(ConductorTheme.symphony.opacity(0.03))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(ConductorTheme.symphony.opacity(0.1), lineWidth: 1)
                )
        )
    }

    // MARK: - Empty State

    private var emptyState: some View {
        Text("No active team threads")
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .padding(.vertical, 2)
    }

    // MARK: - Helpers

    private func agentColor(for role: String) -> Color {
        // Deterministic hash: sum of character Unicode scalars
        let hash = role.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }
        let index = abs(hash) % Self.agentColors.count
        return Self.agentColors[index]
    }

    /// Deterministic color for project badges.
    private func projectBadgeColor(_ project: String) -> Color {
        let hash = project.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }
        let hue = Double(abs(hash) % 360) / 360.0
        return Color(hue: hue, saturation: 0.6, brightness: 0.7)
    }
}

// MARK: - Message Bubble

struct TeamMessageBubble: View {
    let note: SymphonyNote
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            // Sender attribution + time
            HStack(spacing: 4) {
                // Colored role badge
                Text(attribution)
                    .font(.system(size: ConductorTheme.fontSM, weight: .semibold, design: .monospaced))
                    .foregroundStyle(color)

                Spacer()

                Text(relativeTime)
                    .font(.system(size: ConductorTheme.fontXS))
                    .foregroundStyle(.tertiary)
            }

            // Intent badge
            HStack(spacing: 4) {
                Text(note.intent.rawValue)
                    .font(.system(size: ConductorTheme.fontXS, weight: .medium))
                    .foregroundStyle(intentColor)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(intentColor.opacity(0.15)))

                // Symbols
                if !note.symbols.isEmpty {
                    Text(note.symbols.joined(separator: " "))
                        .font(.system(size: ConductorTheme.fontXS))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            // Message content (strip attribution prefix if present)
            Text(strippedContent)
                .font(.caption2)
                .foregroundStyle(.primary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)

            // Code diff if present
            if let diff = note.content.diff, !diff.isEmpty {
                Text(diff)
                    .font(.system(size: ConductorTheme.fontSM, design: .monospaced))
                    .foregroundStyle(.primary)
                    .padding(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.black.opacity(0.05))
                    )
            }

            // Decision highlight
            if let decision = note.content.decision, !decision.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: ConductorTheme.fontXS))
                        .foregroundStyle(ConductorTheme.degraded)
                    Text(decision)
                        .font(.caption2.bold())
                        .foregroundStyle(.primary)
                }
                .padding(4)
                .background(
                    RoundedRectangle(cornerRadius: 4)
                        .fill(ConductorTheme.degraded.opacity(0.1))
                )
            }
        }
        .padding(6)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
    }

    // MARK: - Computed

    /// Attribution text: "[nickname (role)]" or "[role]"
    private var attribution: String {
        let role = note.sender.role ?? note.sender.name
        if let project = note.sender.project {
            return "[\(role)@\(project)]"
        }
        return "[\(role)]"
    }

    /// Strip "[role] " prefix from content if present
    private var strippedContent: String {
        let text = note.content.text
        if text.hasPrefix("["),
           let closeBracket = text.firstIndex(of: "]") {
            let afterBracket = text.index(after: closeBracket)
            let remaining = text[afterBracket...]
            return remaining.hasPrefix(" ")
                ? String(remaining.dropFirst())
                : String(remaining)
        }
        return text
    }

    private var relativeTime: String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: note.timestamp) else {
            return note.timestamp
        }
        let interval = Date().timeIntervalSince(date)
        if interval < 60 { return "just now" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86400 { return "\(Int(interval / 3600))h ago" }
        return "\(Int(interval / 86400))d ago"
    }

    private var intentColor: Color {
        switch note.intent {
        case .question: return ConductorTheme.active
        case .context, .clarification: return ConductorTheme.brand
        case .proposal, .handoff: return ConductorTheme.warning
        case .verification: return ConductorTheme.symphony
        case .action, .approval, .taskComplete: return ConductorTheme.healthy
        case .decision: return ConductorTheme.degraded
        case .alert, .rejection, .taskFailed: return ConductorTheme.critical
        case .reference: return .gray
        case .fileRequest, .fileApproved, .fileDenied, .fileDelivery: return .indigo
        case .task: return ConductorTheme.active
        case .taskAck: return ConductorTheme.brand
        case .progress: return .mint
        case .approvalRequest: return ConductorTheme.warning
        case .approvalResponse: return ConductorTheme.healthy
        case .panInvoke: return ConductorTheme.active
        case .panResult: return ConductorTheme.healthy
        }
    }
}
