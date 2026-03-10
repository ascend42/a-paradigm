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
            SettingsPlaceholderView()
        }
    }
}

/// Placeholder settings view — full #settings-panel ships in Sprint 7.
struct SettingsPlaceholderView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "music.mic.circle")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Paradigm Conductor")
                .font(.title2.bold())
            Text("Settings will be available in a future update.")
                .foregroundStyle(.secondary)
        }
        .frame(width: 400, height: 200)
        .padding()
    }
}
