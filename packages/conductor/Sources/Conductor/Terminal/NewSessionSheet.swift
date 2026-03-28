// NewSessionSheet.swift — #new-session-sheet
// Project picker for creating new embedded terminal sessions.
// Shows recent projects and a Browse button for folder selection.

import SwiftUI

/// Sheet for creating a new embedded terminal session.
struct NewSessionSheet: View {
    @ObservedObject var sessionManager: TerminalSessionManager
    @ObservedObject var projectStore: ProjectStore
    let cellIndex: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack {
                Image(systemName: "terminal")
                    .foregroundStyle(ConductorTheme.brand)
                Text("New Session")
                    .font(.headline)
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
            }

            Divider()

            // Recent projects
            if !projectStore.projects.isEmpty {
                Text("Recent Projects")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)

                ForEach(projectStore.projects.prefix(8)) { project in
                    Button(action: { launchSession(projectPath: project.path) }) {
                        HStack(spacing: 8) {
                            Image(systemName: "folder.fill")
                                .foregroundStyle(ConductorTheme.brand.opacity(0.7))
                                .frame(width: 16)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(project.name)
                                    .font(.system(size: 13, weight: .medium))
                                Text(shortenPath(project.path))
                                    .font(.system(size: 10))
                                    .foregroundStyle(.tertiary)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 4)
                        .padding(.horizontal, 8)
                        .background(Color.white.opacity(0.03))
                        .cornerRadius(6)
                    }
                    .buttonStyle(.plain)
                }
            }

            Divider()

            // Browse button
            Button(action: browseForFolder) {
                HStack {
                    Image(systemName: "folder.badge.plus")
                    Text("Browse for Folder...")
                }
                .frame(maxWidth: .infinity)
            }
            .controlSize(.regular)
            .buttonStyle(.borderedProminent)

            // Session count
            Text("\(sessionManager.sessions.count)/\(sessionManager.maxSessions) sessions active")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(20)
        .frame(width: 320)
    }

    // MARK: - Actions

    private func launchSession(projectPath: String) {
        if let session = sessionManager.createSession(projectPath: projectPath) {
            sessionManager.assignToCell(sessionId: session.id, cellId: "cell-\(cellIndex)")
        }
        dismiss()
    }

    private func browseForFolder() {
        let panel = NSOpenPanel()
        panel.title = "Select Project Folder"
        panel.message = "Choose a project directory to launch Claude Code in"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        if panel.runModal() == .OK, let url = panel.url {
            launchSession(projectPath: url.path)
        }
    }

    private func shortenPath(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path.hasPrefix(home) {
            return "~" + path.dropFirst(home.count)
        }
        return path
    }
}
