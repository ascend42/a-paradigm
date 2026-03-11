// WorkspaceSettingsView.swift — #workspace-settings
// New Settings tab for workspace configuration.
// Default terminal, sidebar position, sidebar width, max instances, auto-arrange.

import SwiftUI

struct WorkspaceSettingsView: View {
    @ObservedObject var workspaceManager: WorkspaceManager

    var body: some View {
        Form {
            Section("Terminal") {
                Picker("Default terminal", selection: $workspaceManager.defaultTerminal) {
                    ForEach(TerminalApp.allCases) { app in
                        Text(app.rawValue).tag(app)
                    }
                }
            }

            Section("Sidebar") {
                Picker("Position", selection: $workspaceManager.sidebarSide) {
                    Text("Left").tag(WorkspaceGrid.SidebarSide.left)
                    Text("Right").tag(WorkspaceGrid.SidebarSide.right)
                }

                HStack {
                    Text("Width")
                    Spacer()
                    Slider(value: $workspaceManager.sidebarWidth, in: 280...500, step: 10)
                        .frame(width: 150)
                    Text("\(Int(workspaceManager.sidebarWidth))px")
                        .monospacedDigit()
                        .frame(width: 44)
                }
            }

            Section("Instances") {
                Stepper("Max instances: \(workspaceManager.maxInstances)",
                        value: $workspaceManager.maxInstances, in: 1...8)

                Toggle("Auto-arrange windows", isOn: $workspaceManager.autoArrange)
            }

            Section {
                Button("Save Settings") {
                    workspaceManager.saveSettings()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
    }
}
