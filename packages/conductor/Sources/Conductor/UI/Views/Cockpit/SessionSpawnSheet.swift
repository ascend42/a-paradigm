// SessionSpawnSheet.swift — #session-spawn-sheet
// The sheet that spawns a new session into THE BRIDGE. Sits over a dimmed cockpit:
// a list of ProjectStore recents + a "Browse…" NSOpenPanel folder picker + an
// optional opening-prompt field. On confirm it calls store.spawn(...) and records
// the project into the ProjectStore so it surfaces as a recent next time.

import AppKit
import SwiftUI

struct SessionSpawnSheet: View {
    @ObservedObject var store: FleetStore
    @ObservedObject var projectStore: ProjectStore
    @Binding var isPresented: Bool

    /// The chosen project path (a recent, or a Browse… pick).
    @State private var selectedPath: String?
    /// Optional opening turn — seeds the first round-trip.
    @State private var openingPrompt: String = ""
    /// Set when the founder is past the soft cap and must confirm.
    @State private var pendingForce = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header

            // Recents.
            Text("RECENT PROJECTS")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(AtriumTheme.inkMuted)
                .tracking(1.0)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(projectStore.sorted) { project in
                        recentRow(project)
                    }
                    if projectStore.sorted.isEmpty {
                        Text("No recent projects — Browse… to pick a folder.")
                            .font(AtriumTheme.footerFont)
                            .foregroundColor(AtriumTheme.hairline)
                            .padding(.vertical, 6)
                    }
                }
            }
            .frame(maxHeight: 200)

            Button(action: browse) {
                HStack(spacing: 7) {
                    Image(systemName: "folder")
                        .font(.system(size: 11))
                    Text("Browse…")
                        .font(AtriumTheme.chipFont)
                }
                .foregroundColor(AtriumTheme.user)
            }
            .buttonStyle(.plain)

            Divider().overlay(AtriumTheme.hairline)

            // Opening prompt.
            Text("OPENING PROMPT (optional)")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(AtriumTheme.inkMuted)
                .tracking(1.0)
            TextEditor(text: $openingPrompt)
                .font(AtriumTheme.bodyFont)
                .foregroundColor(AtriumTheme.ink)
                .scrollContentBackground(.hidden)
                .padding(6)
                .frame(height: 64)
                .background(AtriumTheme.sunken)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(AtriumTheme.hairline, lineWidth: 1)
                )

            if store.atSoftCap {
                Text("Fleet is at the soft cap (\(FleetStore.softCap)). You can still spawn, but the bridge will be busy.")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.amber)
            }

            footerButtons
        }
        .padding(20)
        .frame(width: 460)
        .background(AtriumTheme.surface)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("Start a session")
                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                .foregroundColor(AtriumTheme.ink)
            Spacer()
            if let path = selectedPath {
                Text(URL(fileURLWithPath: path).lastPathComponent)
                    .font(AtriumTheme.chipFont)
                    .foregroundColor(AtriumTheme.user)
            }
        }
    }

    private func recentRow(_ project: RecentProject) -> some View {
        Button(action: { selectedPath = project.path }) {
            HStack(spacing: 8) {
                Image(systemName: project.pinned ? "pin.fill" : "folder")
                    .font(.system(size: 10))
                    .foregroundColor(selectedPath == project.path ? AtriumTheme.user : AtriumTheme.inkMuted)
                    .frame(width: 14)
                VStack(alignment: .leading, spacing: 1) {
                    Text(project.name)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(AtriumTheme.ink)
                        .lineLimit(1)
                    Text(project.path)
                        .font(AtriumTheme.footerFont)
                        .foregroundColor(AtriumTheme.inkMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(selectedPath == project.path ? AtriumTheme.surfaceRaised : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var footerButtons: some View {
        HStack(spacing: 10) {
            Spacer()
            Button("Cancel") { isPresented = false }
                .keyboardShortcut(.cancelAction)
            Button(action: confirm) {
                Text("Spawn")
                    .fontWeight(.semibold)
            }
            .keyboardShortcut(.defaultAction)
            .disabled(selectedPath == nil)
        }
    }

    // MARK: - Actions

    /// NSOpenPanel folder picker (#session-spawn-sheet).
    private func browse() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose Project"
        panel.message = "Choose a project folder to start a session in"
        if panel.runModal() == .OK, let url = panel.url {
            selectedPath = url.path
            ConductorLog.component("session-spawn-sheet")
                .info("Browse picked \(url.path)")
        }
    }

    private func confirm() {
        guard let path = selectedPath else { return }
        let prompt = openingPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = URL(fileURLWithPath: path).lastPathComponent

        // Past-cap spawns are forced (the founder confirmed by clicking Spawn with
        // the warning shown). Within cap, a normal spawn.
        let id = store.spawn(
            projectPath: path,
            initialPrompt: prompt.isEmpty ? nil : prompt,
            force: store.atSoftCap
        )
        if id != nil {
            projectStore.addOrUpdate(path: path, name: name)
            ConductorLog.flow("fleet-spawn")
                .info("spawn sheet → session \(id!) @ \(path); recent recorded")
        }
        isPresented = false
    }
}
