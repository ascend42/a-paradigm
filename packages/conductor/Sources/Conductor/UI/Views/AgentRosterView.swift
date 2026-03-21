// AgentRosterView.swift — #agent-roster-view
// Displays agent roster with status indicators, acceptance rates, and bench controls.
// Part of Maestro Phase 2 — Conductor team display.

import SwiftUI

struct AgentRosterView: View {
    @ObservedObject var threadWatcher: SymphonyThreadWatcher
    let agents: [RosterAgent]
    let onBench: (String) -> Void
    let onActivate: (String) -> Void

    @State private var isCollapsed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            headerRow
            if !isCollapsed {
                if agents.isEmpty {
                    emptyState
                } else {
                    agentList
                }
            }
        }
    }

    // MARK: - Header

    private var headerRow: some View {
        HStack(spacing: 6) {
            Image(systemName: "person.crop.rectangle.stack.fill")
                .foregroundStyle(.purple)
                .font(.caption)

            Text("Agent Roster")
                .font(.caption.bold())

            let activeCount = agents.filter { !$0.benched }.count
            let benchedCount = agents.filter(\.benched).count

            Text("\(activeCount) active")
                .font(.system(size: 8, weight: .medium))
                .foregroundStyle(.green)

            if benchedCount > 0 {
                Text("\(benchedCount) benched")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isCollapsed.toggle()
                }
            } label: {
                Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                    .font(.system(size: 8))
                    .foregroundStyle(.tertiary)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Agent List

    private var agentList: some View {
        VStack(alignment: .leading, spacing: 3) {
            // Active agents
            ForEach(agents.filter { !$0.benched }) { agent in
                AgentRosterRow(
                    agent: agent,
                    attribution: threadWatcher.agentAttributions[agent.role],
                    isBenched: false,
                    onToggle: { onBench(agent.id) }
                )
            }

            // Benched agents
            let benched = agents.filter(\.benched)
            if !benched.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "tray.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(.secondary)
                    Text("Benched")
                        .font(.system(size: 8, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 4)

                ForEach(benched) { agent in
                    AgentRosterRow(
                        agent: agent,
                        attribution: threadWatcher.agentAttributions[agent.role],
                        isBenched: true,
                        onToggle: { onActivate(agent.id) }
                    )
                }
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.purple.opacity(0.03))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.purple.opacity(0.1), lineWidth: 1)
                )
        )
    }

    // MARK: - Empty State

    private var emptyState: some View {
        Text("No agents registered")
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .padding(.vertical, 2)
    }
}

// MARK: - Roster Agent Model

struct RosterAgent: Identifiable {
    let id: String
    let role: String
    let nickname: String?
    let project: String
    var benched: Bool
    var acceptanceRate: Double?
    var expertiseCount: Int
    var lastActive: String?
    var threshold: Double?
}

// MARK: - Agent Row

struct AgentRosterRow: View {
    let agent: RosterAgent
    let attribution: String?
    let isBenched: Bool
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            // Status dot
            Circle()
                .fill(isBenched ? Color.gray : Color.green)
                .frame(width: 6, height: 6)

            // Name/role
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    if let nickname = agent.nickname {
                        Text(nickname)
                            .font(.caption.weight(.semibold))
                        Text("(\(agent.role))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else {
                        Text(agent.role)
                            .font(.caption.weight(.semibold))
                    }
                }
                .lineLimit(1)
                .opacity(isBenched ? 0.5 : 1.0)

                // Stats row
                HStack(spacing: 6) {
                    if let rate = agent.acceptanceRate {
                        Label("\(Int(rate * 100))%", systemImage: "checkmark.circle")
                            .font(.system(size: 8))
                            .foregroundStyle(rate >= 0.7 ? .green : rate >= 0.5 ? .yellow : .red)
                    }

                    if agent.expertiseCount > 0 {
                        Label("\(agent.expertiseCount)", systemImage: "star")
                            .font(.system(size: 8))
                            .foregroundStyle(.secondary)
                    }

                    if let threshold = agent.threshold {
                        Label(String(format: "%.2f", threshold), systemImage: "slider.horizontal.3")
                            .font(.system(size: 8))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer()

            // Bench/Activate toggle
            Button {
                onToggle()
            } label: {
                Image(systemName: isBenched ? "play.circle" : "pause.circle")
                    .font(.system(size: 10))
                    .foregroundStyle(isBenched ? .green : .secondary)
            }
            .buttonStyle(.plain)
            .help(isBenched ? "Activate agent" : "Bench agent")
        }
        .padding(.vertical, 2)
    }
}
