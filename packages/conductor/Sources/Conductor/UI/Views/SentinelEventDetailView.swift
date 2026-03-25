// SentinelEventDetailView.swift — #sentinel-event-detail
// Popover for a single SentinelEvent with full details and related tasks.

import SwiftUI

struct SentinelEventDetailView: View {
    let event: SentinelEvent
    var relatedTasks: [TaskRecord] = []

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        return f
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack {
                Text("Event Detail")
                    .font(.headline)
                Spacer()
                levelBadge(event.level)
                typeBadge(event.type)
            }

            Divider()

            // Timestamp
            HStack(spacing: 4) {
                Image(systemName: "clock")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                Text(Self.dateFormatter.string(from: event.timestamp))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            // Symbol (copyable)
            if let symbol = event.symbol {
                HStack(spacing: 4) {
                    Image(systemName: "number")
                        .font(.system(size: 10))
                        .foregroundStyle(ConductorTheme.symphony)
                    Text(symbol)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(ConductorTheme.symphony)
                        .textSelection(.enabled)
                }
            }

            // Full message
            if let message = event.message {
                Text("Message")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Text(message)
                    .font(.system(size: 11))
                    .textSelection(.enabled)
            }

            // Metadata key-value pairs
            if let metadata = event.metadata, !metadata.isEmpty {
                Text("Metadata")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                ForEach(metadata.keys.sorted(), id: \.self) { key in
                    HStack(alignment: .top, spacing: 4) {
                        Text(key)
                            .font(.system(size: ConductorTheme.fontSM, design: .monospaced))
                            .foregroundStyle(ConductorTheme.brand)
                            .frame(width: 80, alignment: .trailing)
                        Text(metadata[key] ?? "")
                            .font(.system(size: ConductorTheme.fontSM, design: .monospaced))
                            .foregroundStyle(.primary)
                            .textSelection(.enabled)
                    }
                }
            }

            // Related tasks
            if !relatedTasks.isEmpty {
                Divider()
                Text("Related Tasks")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                ForEach(relatedTasks) { task in
                    HStack(spacing: 6) {
                        Text(String(task.id.suffix(8)))
                            .font(.system(size: ConductorTheme.fontSM, design: .monospaced))
                            .foregroundStyle(.secondary)

                        taskStatusPill(task.status)

                        if task.progress > 0 && task.progress < 100 {
                            Text("\(task.progress)%")
                                .font(.system(size: ConductorTheme.fontXS, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding()
        .frame(width: 350)
    }

    // MARK: - Helpers

    private func levelBadge(_ level: String) -> some View {
        Text(level.uppercased())
            .font(.system(size: ConductorTheme.fontXS, weight: .bold))
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(Capsule().fill(levelColor(level).opacity(0.15)))
            .foregroundStyle(levelColor(level))
    }

    private func typeBadge(_ type: String) -> some View {
        Text(type)
            .font(.system(size: ConductorTheme.fontXS, weight: .medium))
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(Capsule().fill(.secondary.opacity(0.1)))
            .foregroundStyle(.secondary)
    }

    private func taskStatusPill(_ status: TaskStatus) -> some View {
        Text(statusLabel(status))
            .font(.system(size: ConductorTheme.fontXS, weight: .medium))
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(Capsule().fill(statusColor(status).opacity(0.15)))
            .foregroundStyle(statusColor(status))
    }

    private func levelColor(_ level: String) -> Color {
        switch level {
        case "error": return ConductorTheme.critical
        case "warn": return ConductorTheme.warning
        case "info": return ConductorTheme.active
        default: return .secondary
        }
    }

    private func statusLabel(_ status: TaskStatus) -> String {
        switch status {
        case .assigned: return "Assigned"
        case .acknowledged: return "Ack"
        case .inProgress: return "In Progress"
        case .blocked: return "Blocked"
        case .awaitingApproval: return "Pending"
        case .complete: return "Done"
        case .failed: return "Failed"
        }
    }

    private func statusColor(_ status: TaskStatus) -> Color {
        switch status {
        case .assigned, .acknowledged, .inProgress: return ConductorTheme.active
        case .blocked: return ConductorTheme.critical
        case .awaitingApproval: return ConductorTheme.warning
        case .complete: return ConductorTheme.healthy
        case .failed: return ConductorTheme.critical
        }
    }
}
