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
                customGestureClassifier: appDelegate.orchestrator.customGestureClassifier
            )
        }
    }
}
