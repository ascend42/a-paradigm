// ConductorCockpitWindow.swift — #conductor-cockpit-window
// THE BRIDGE window. Generalizes the retired AtriumSpikeWindow: instead of owning
// ONE ClaudeStreamSession, it hosts a CockpitView over an INJECTED FleetStore
// (AppDelegate owns the store — the window does NOT, so the fleet survives a window
// close/reopen and AppDelegate can shut it down on terminate). On close, the fleet
// is torn down (every session shut down) and onClose fires so the owner drops its
// window reference.
//
// PRESERVED VERBATIM from AtriumSpikeWindow (the hard-won LSUIElement key-window
// fixes): canBecomeKey/canBecomeMain overrides, collectionBehavior
// .fullScreenPrimary/.managed, initialFirstResponder = contentView. An accessory
// (LSUIElement) app's programmatic window is treated as non-key by AppKit
// otherwise, and the composer TextField can never take keyboard focus.

import AppKit
import SwiftUI

@MainActor
final class ConductorCockpitWindow: NSWindow {

    /// The fleet the cockpit renders. INJECTED — owned by AppDelegate, NOT by this
    /// window, so it outlives any single window and AppDelegate can shutdownAll().
    let fleetStore: FleetStore
    let projectStore: ProjectStore

    /// Invoked after the window closes (and the fleet is torn down) so the owner can
    /// drop its reference and a reopen builds a fresh window.
    var onClose: (() -> Void)?

    init(fleetStore: FleetStore, projectStore: ProjectStore) {
        self.fleetStore = fleetStore
        self.projectStore = projectStore

        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1600, height: 1000)
        // Default larger than the old spike — THE BRIDGE is full-screen-bound. Clamp
        // to the visible screen so it always fits.
        let width: CGFloat = min(1500, screenFrame.width - 80)
        let height: CGFloat = min(950, screenFrame.height - 80)
        let frame = NSRect(
            x: screenFrame.midX - width / 2,
            y: screenFrame.midY - height / 2,
            width: width,
            height: height
        )

        super.init(
            contentRect: frame,
            styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        configure()
        contentView = NSHostingView(
            rootView: CockpitView(store: fleetStore, projectStore: projectStore)
        )
        // PRESERVED: an LSUIElement app's window needs an explicit first responder so
        // SwiftUI text fields can take key focus.
        initialFirstResponder = contentView

        ConductorLog.component("conductor-cockpit-window")
            .info("THE BRIDGE cockpit window launched (\(Int(width))×\(Int(height)))")
    }

    private func configure() {
        title = "THE BRIDGE"
        titleVisibility = .visible
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true
        isOpaque = true
        backgroundColor = NSColor(srgbRed: 0x0B / 255, green: 0x0E / 255, blue: 0x14 / 255, alpha: 1.0)
        hasShadow = true
        minSize = NSSize(width: 900, height: 600)
        isReleasedWhenClosed = false
        // PRESERVED VERBATIM from AtriumSpikeWindow: full-screen-capable even though
        // the app is an LSUIElement accessory; .managed keeps it in the window cycle.
        collectionBehavior.insert(.fullScreenPrimary)
        collectionBehavior.insert(.managed)
        delegate = self
    }

    // PRESERVED VERBATIM: forcing these true guarantees the accessory app's
    // programmatic window accepts key status so the composer can take input.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

// MARK: - NSWindowDelegate

extension ConductorCockpitWindow: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        fleetStore.shutdownAll()
        ConductorLog.component("conductor-cockpit-window")
            .info("THE BRIDGE cockpit window closing — fleet shut down")
        onClose?()
    }
}
