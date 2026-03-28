// ContainerWindow.swift — #container-window
// NSWindow-based workspace container. Full-screen capable tiling workspace
// replacing the sidebar NSPanel for container mode.

import AppKit

final class ContainerWindow: NSWindow {

    /// Padding from screen edges for non-fullscreen mode.
    private let edgePadding: CGFloat = 0

    init() {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1920, height: 1080)

        // Start at full visible screen area
        let frame = NSRect(
            x: screenFrame.minX + 0,
            y: screenFrame.minY + 0,
            width: screenFrame.width,
            height: screenFrame.height
        )

        super.init(
            contentRect: frame,
            styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        configure()
    }

    private func configure() {
        // Title bar
        title = "Conductor"
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true

        // Full-screen support
        collectionBehavior = [.fullScreenPrimary, .managed]

        // Appearance
        isOpaque = false
        backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.96)
        hasShadow = true

        // Size constraints
        minSize = NSSize(width: 800, height: 600)

        // Allow the content view to extend under the title bar
        // for a seamless header bar experience
        if let toolbar = toolbar {
            toolbar.isVisible = false
        }

        ConductorLog.component("container-window").info("Container window configured")
    }

    /// Callback for font size changes (set by AppDelegate).
    var onZoomIn: (() -> Void)?
    var onZoomOut: (() -> Void)?

    /// Intercept key equivalents before any subview (including SwiftTerm).
    /// This is the only reliable way to handle Cmd+=/- when a terminal has focus.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.modifierFlags.contains(.command) else {
            return super.performKeyEquivalent(with: event)
        }

        switch event.charactersIgnoringModifiers {
        case "=", "+":
            onZoomIn?()
            return true
        case "-":
            onZoomOut?()
            return true
        default:
            return super.performKeyEquivalent(with: event)
        }
    }

    /// Fit to screen (not full-screen, but maximized within visible area).
    func fitToScreen() {
        guard let screen = NSScreen.main else { return }
        let frame = screen.visibleFrame
        setFrame(frame, display: true, animate: true)
    }
}
