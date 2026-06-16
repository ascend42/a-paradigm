// AtriumShellsPanel.swift — #atrium-shells
// The background-shell inspector surfaced in the ATRIUM window. A small header
// button shows a live count ("⛭ N shells") and opens a popover listing each
// shell the agent spawned: command (mono, truncated), id, status, startedAt, and
// [Inspect] / [Kill] actions. Inspect and Kill are agent-mediated (v1): they ask
// the owned ClaudeStreamSession to send a BashOutput / KillShell turn. Empty
// state when there are no shells. ATRIUM palette throughout.

import SwiftUI

/// Header button + popover for background-shell inspection (#atrium-shells).
struct AtriumShellsButton: View {
    @ObservedObject var session: ClaudeStreamSession
    @State private var showPopover = false

    private var count: Int { session.backgroundShells.count }
    private var runningCount: Int {
        session.backgroundShells.filter { $0.status == .running }.count
    }

    var body: some View {
        Button(action: { showPopover.toggle() }) {
            HStack(spacing: 5) {
                Image(systemName: "gearshape.2")
                    .font(.system(size: 11, weight: .medium))
                Text(countLabel)
                    .font(AtriumTheme.chipFont)
            }
            .foregroundColor(count == 0 ? AtriumTheme.inkMuted : AtriumTheme.tool)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(AtriumTheme.surfaceRaised)
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .stroke(count == 0 ? AtriumTheme.hairline : AtriumTheme.tool, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .help("Background shells the agent spawned. Inspect or kill them here.")
        .popover(isPresented: $showPopover, arrowEdge: .bottom) {
            AtriumShellsPanel(session: session)
        }
    }

    private var countLabel: String {
        if count == 0 { return "0 shells" }
        let noun = count == 1 ? "shell" : "shells"
        if runningCount != count {
            return "\(count) \(noun) · \(runningCount) live"
        }
        return "\(count) \(noun)"
    }
}

/// The popover body listing tracked shells.
struct AtriumShellsPanel: View {
    @ObservedObject var session: ClaudeStreamSession
    /// Shell ids whose output detail is expanded (host-side Inspect, FIX 3).
    @State private var expanded: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(AtriumTheme.hairline)
            if session.backgroundShells.isEmpty {
                emptyState
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(session.backgroundShells) { shell in
                            row(for: shell)
                        }
                    }
                    .padding(12)
                }
                .frame(maxHeight: 320)
            }
        }
        .frame(width: 380)
        .background(AtriumTheme.surface)
    }

    private var header: some View {
        HStack {
            Text("BACKGROUND SHELLS")
                .font(AtriumTheme.footerFont)
                .foregroundColor(AtriumTheme.inkMuted)
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(AtriumTheme.sunken)
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Image(systemName: "gearshape.2")
                .font(.system(size: 20, weight: .light))
                .foregroundColor(AtriumTheme.hairline)
            Text("No background shells")
                .font(AtriumTheme.chipFont)
                .foregroundColor(AtriumTheme.inkMuted)
            Text("Shells the agent runs in the background appear here.")
                .font(AtriumTheme.footerFont)
                .foregroundColor(AtriumTheme.hairline)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 16)
    }

    private func row(for shell: BackgroundShell) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            // Command (mono, truncated).
            Text(shell.command)
                .font(AtriumTheme.bodyFont)
                .foregroundColor(AtriumTheme.ink)
                .lineLimit(2)
                .truncationMode(.middle)

            HStack(spacing: 8) {
                statusBadge(shell.status)
                Text("id:\(shell.id)")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
                Text(Self.timeFormatter.string(from: shell.startedAt))
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
                Spacer()
            }

            let isExpanded = expanded.contains(shell.id)
            if let output = shell.lastOutput, !output.isEmpty {
                if isExpanded {
                    // Host-side Inspect detail (FIX 3): the full .output contents,
                    // scrollable, read directly from disk — no agent round-trip.
                    ScrollView {
                        Text(output)
                            .font(AtriumTheme.footerFont)
                            .foregroundColor(AtriumTheme.ink)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(6)
                    }
                    .frame(maxHeight: 200)
                    .background(AtriumTheme.sunken)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                } else {
                    Text(output)
                        .font(AtriumTheme.footerFont)
                        .foregroundColor(AtriumTheme.inkMuted)
                        .lineLimit(3)
                        .truncationMode(.tail)
                        .padding(6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(AtriumTheme.sunken)
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                }
            }

            HStack(spacing: 8) {
                actionButton(isExpanded ? "Hide" : "Inspect", tint: AtriumTheme.user) {
                    // Read the .output file host-side, then expand the detail.
                    session.inspectShell(id: shell.id)
                    if isExpanded {
                        expanded.remove(shell.id)
                    } else {
                        expanded.insert(shell.id)
                    }
                }
                actionButton("Kill", tint: AtriumTheme.blocked) {
                    session.killShell(id: shell.id)
                }
                .disabled(shell.status == .killed)
                .opacity(shell.status == .killed ? 0.4 : 1)
                Spacer()
            }
        }
        .padding(10)
        .background(AtriumTheme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func statusBadge(_ status: BackgroundShellStatus) -> some View {
        let (text, color): (String, Color) = {
            switch status {
            case .running: return ("running", AtriumTheme.running)
            case .finished: return ("finished", AtriumTheme.inkMuted)
            case .stopped: return ("stopped", AtriumTheme.inkMuted)
            case .killed: return ("killed", AtriumTheme.blocked)
            }
        }()
        return Text(text)
            .font(AtriumTheme.footerFont)
            .foregroundColor(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(color.opacity(0.5), lineWidth: 1)
            )
    }

    private func actionButton(_ label: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(AtriumTheme.chipFont)
                .foregroundColor(tint)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(tint.opacity(0.6), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()
}
