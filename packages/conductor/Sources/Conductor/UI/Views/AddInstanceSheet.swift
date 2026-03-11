// AddInstanceSheet.swift — #workspace-view
// Modal sheet for launching a new Claude Code instance.
// Project directory picker, terminal selector, label field.

import SwiftUI

struct AddInstanceSheet: View {
    @ObservedObject var workspaceManager: WorkspaceManager
    @Binding var isPresented: Bool

    @State private var projectDirectory: String = ""
    @State private var label: String = ""
    @State private var selectedTerminal: TerminalApp
    @State private var isLaunching = false
    @State private var errorMessage: String?

    init(workspaceManager: WorkspaceManager, isPresented: Binding<Bool>) {
        self.workspaceManager = workspaceManager
        self._isPresented = isPresented
        self._selectedTerminal = State(initialValue: workspaceManager.defaultTerminal)
    }

    var body: some View {
        VStack(spacing: 16) {
            // Header
            Text("Launch Claude Code")
                .font(.headline)

            // Project directory
            VStack(alignment: .leading, spacing: 4) {
                Text("Project Directory")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                HStack {
                    TextField("~/Projects/my-app", text: $projectDirectory)
                        .textFieldStyle(.roundedBorder)

                    Button("Browse\u{2026}") {
                        browseDirectory()
                    }
                    .controlSize(.small)
                }
            }

            // Label
            VStack(alignment: .leading, spacing: 4) {
                Text("Label")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                TextField("my-app", text: $label)
                    .textFieldStyle(.roundedBorder)
            }

            // Terminal selector
            VStack(alignment: .leading, spacing: 4) {
                Text("Terminal")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                Picker("Terminal", selection: $selectedTerminal) {
                    ForEach(TerminalApp.allCases) { app in
                        Text(app.rawValue).tag(app)
                    }
                }
                .labelsHidden()
            }

            // Error
            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Spacer()

            // Actions
            HStack {
                Button("Cancel") {
                    isPresented = false
                }
                .keyboardShortcut(.cancelAction)

                Spacer()

                Button(action: launchInstance) {
                    if isLaunching {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text("Launch")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(projectDirectory.isEmpty || isLaunching)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 400, height: 320)
    }

    private func browseDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Select"

        if panel.runModal() == .OK, let url = panel.url {
            projectDirectory = url.path
            if label.isEmpty {
                label = url.lastPathComponent
            }
        }
    }

    private func launchInstance() {
        guard !projectDirectory.isEmpty else { return }

        let dir = (projectDirectory as NSString).expandingTildeInPath
        guard FileManager.default.fileExists(atPath: dir) else {
            errorMessage = "Directory does not exist"
            return
        }

        let instanceLabel = label.isEmpty ? URL(fileURLWithPath: dir).lastPathComponent : label
        isLaunching = true
        errorMessage = nil

        Task {
            do {
                try await workspaceManager.launchInstance(projectDir: dir, label: instanceLabel)
                isPresented = false
            } catch {
                errorMessage = error.localizedDescription
            }
            isLaunching = false
        }
    }
}
