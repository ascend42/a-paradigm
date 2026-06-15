// ConductorApp.swift — #conductor-app
// Main entry point for Paradigm Conductor.
// Lifecycle: launch → check permissions → show panel → menu bar icon.

import SwiftUI

@main
struct ConductorApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        // Conductor uses a floating panel, not a standard window.
        // The panel is managed by AppDelegate.
        Settings {
            SettingsPanelView(
                workspaceManager: appDelegate.workspaceManager,
                actionRegistry: appDelegate.orchestrator.actionRegistry,
                voiceCommandRegistry: appDelegate.orchestrator.voiceCommandRegistry,
                customGestureClassifier: appDelegate.orchestrator.customGestureClassifier,
                agentPartManager: appDelegate.agentPartManager,
                noteRelay: appDelegate.noteRelay,
                projectStore: appDelegate.projectStore,
                agentProcessManager: appDelegate.agentProcessManager
            )
        }
        // SwiftUI owns the menu bar in an `App` scene, overriding any NSApp.mainMenu
        // the AppDelegate sets. So the ATRIUM spike command must be registered here
        // via `.commands` to actually appear in the menu bar (Conductor → …, ⌘⇧A).
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Open ATRIUM Spike…") {
                    appDelegate.openAtriumSpike()
                }
                .keyboardShortcut("a", modifiers: [.command, .shift])
            }
        }
    }
}
