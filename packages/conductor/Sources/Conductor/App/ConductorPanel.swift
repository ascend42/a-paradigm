// ConductorPanel.swift — #conductor-panel
// NSPanel-based floating overlay window.
// Always-on-top, partially transparent, draggable, click-through for non-interactive regions.

import AppKit

final class ConductorPanel: NSPanel {

    /// Whether the panel is in sidebar mode (full-height, edge-snapped).
    private(set) var isSidebarMode: Bool = true

    /// Which screen edge the sidebar is snapped to.
    var sidebarSide: WorkspaceGrid.SidebarSide = .left {
        didSet { if isSidebarMode { snapToEdge() } }
    }

    /// Sidebar width (configurable, 280–500).
    var sidebarWidth: CGFloat = 320 {
        didSet { if isSidebarMode { snapToEdge() } }
    }

    init(sidebarMode: Bool = true, side: WorkspaceGrid.SidebarSide = .left, width: CGFloat = 320) {
        self.isSidebarMode = sidebarMode
        self.sidebarSide = side
        self.sidebarWidth = width

        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1920, height: 1080)
        let frame: NSRect

        if sidebarMode {
            // Full-height sidebar snapped to screen edge
            let panelX = side == .left ? screenFrame.minX : screenFrame.maxX - width
            frame = NSRect(
                x: panelX,
                y: screenFrame.minY,
                width: width,
                height: screenFrame.height
            )
        } else {
            // Legacy floating overlay mode
            let panelWidth: CGFloat = 320
            let panelHeight: CGFloat = min(600, screenFrame.height - 40)
            let panelX = screenFrame.maxX - panelWidth - 16
            let panelY = screenFrame.midY - panelHeight / 2
            frame = NSRect(x: panelX, y: panelY, width: panelWidth, height: panelHeight)
        }

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
        hidesOnDeactivate = false
        isMovableByWindowBackground = !isSidebarMode // Only draggable in overlay mode
        collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .stationary
        ]

        // Size constraints
        minSize = NSSize(width: 280, height: 300)
        if isSidebarMode {
            maxSize = NSSize(width: 500, height: CGFloat.greatestFiniteMagnitude)
        }

        // Title
        title = "Conductor"
        titleVisibility = .hidden
        titlebarAppearsTransparent = true

        ConductorLog.component("conductor-panel").info("Panel configured (sidebar: \(self.isSidebarMode))")
    }

    /// Snap the panel to the configured screen edge.
    func snapToEdge() {
        let screenFrame = NSScreen.main?.visibleFrame ?? frame
        let panelX = sidebarSide == .left ? screenFrame.minX : screenFrame.maxX - sidebarWidth
        let newFrame = NSRect(
            x: panelX,
            y: screenFrame.minY,
            width: sidebarWidth,
            height: screenFrame.height
        )
        setFrame(newFrame, display: true, animate: true)
    }

    /// Toggle between sidebar and floating overlay modes.
    func toggleMode() {
        isSidebarMode.toggle()
        isMovableByWindowBackground = !isSidebarMode
        if isSidebarMode {
            snapToEdge()
        }
        ConductorLog.component("conductor-panel").info("Panel mode: \(self.isSidebarMode ? "sidebar" : "floating")")
    }
}
