// ConductorPanel.swift — #conductor-panel
// NSPanel-based floating overlay window.
// Always-on-top, partially transparent, draggable, click-through for non-interactive regions.

import AppKit

final class ConductorPanel: NSPanel {

    init() {
        // Default frame: right side of screen, tall and narrow
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1920, height: 1080)
        let panelWidth: CGFloat = 320
        let panelHeight: CGFloat = min(600, screenFrame.height - 40)
        let panelX = screenFrame.maxX - panelWidth - 16
        let panelY = screenFrame.midY - panelHeight / 2

        let frame = NSRect(x: panelX, y: panelY, width: panelWidth, height: panelHeight)

        super.init(
            contentRect: frame,
            styleMask: [.titled, .closable, .resizable, .nonactivatingPanel, .utilityWindow],
            backing: .buffered,
            defer: false
        )

        configure()
    }

    private func configure() {
        // Floating level — stays above normal windows
        level = .floating

        // Transparency and appearance
        isOpaque = false
        backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.92)
        hasShadow = true

        // Behavior
        hidesOnDeactivate = false            // Stay visible when other apps are active
        isMovableByWindowBackground = true   // Drag anywhere
        collectionBehavior = [
            .canJoinAllSpaces,               // Visible in all Spaces
            .fullScreenAuxiliary,            // Visible in full-screen mode
            .stationary                      // Don't move with Space transitions
        ]

        // Minimum size
        minSize = NSSize(width: 280, height: 300)

        // Title
        title = "Conductor"
        titleVisibility = .hidden
        titlebarAppearsTransparent = true

        ConductorLog.component("conductor-panel").info("Panel configured")
    }
}
