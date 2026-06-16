// ConductorApp.swift — #conductor-app
// Main entry point for Paradigm Conductor.
// Lifecycle: launch → check permissions → show panel → menu bar icon.

import AppKit
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
        // the AppDelegate sets. So THE BRIDGE cockpit command must be registered here
        // via `.commands` to actually appear in the menu bar (Conductor → …, ⌘⇧A).
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Open Conductor Cockpit…") {
                    appDelegate.openCockpit()
                }
                .keyboardShortcut("a", modifiers: [.command, .shift])
            }
            // Standard Edit menu (Cut/Copy/Paste/Select All). Belt-and-suspenders
            // for the ATRIUM composer: the real guarantee is AtriumNSTextView's
            // performKeyEquivalent override, but registering the menu means the
            // commands also appear/route normally and feed the responder chain.
            CommandGroup(replacing: .textEditing) {
                Button("Cut") {
                    NSApp.sendAction(#selector(NSText.cut(_:)), to: nil, from: nil)
                }
                .keyboardShortcut("x", modifiers: .command)
                Button("Copy") {
                    NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: nil)
                }
                .keyboardShortcut("c", modifiers: .command)
                Button("Paste") {
                    NSApp.sendAction(#selector(NSText.paste(_:)), to: nil, from: nil)
                }
                .keyboardShortcut("v", modifiers: .command)
                Button("Select All") {
                    NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: nil)
                }
                .keyboardShortcut("a", modifiers: .command)
            }
        }
    }
}
