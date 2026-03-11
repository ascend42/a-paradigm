// GazeCursorController.swift — #gaze-cursor
// Transparent, click-through overlay showing a small dot at the current gaze position.
// Toggle via Settings > Input > Gaze > "Show gaze cursor".

import AppKit
import Combine
import SwiftUI

/// Manages a borderless, click-through overlay window that renders the gaze cursor.
@MainActor
final class GazeCursorController {

    private var window: NSWindow?
    private var cursorView: NSHostingView<GazeCursorView>?
    private var cancellable: AnyCancellable?

    /// Size of the gaze cursor dot.
    private let cursorSize: CGFloat = 20

    // MARK: - Lifecycle

    /// Start showing the gaze cursor, tracking points from the given router.
    func start(gazeRouter: GazeRouter) {
        guard window == nil, let screen = NSScreen.main else { return }

        let view = GazeCursorView()
        let hosting = NSHostingView(rootView: view)

        let win = NSWindow(
            contentRect: screen.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )

        win.level = .screenSaver
        win.isOpaque = false
        win.backgroundColor = .clear
        win.hasShadow = false
        win.ignoresMouseEvents = true
        win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        win.contentView = hosting

        self.window = win
        self.cursorView = hosting

        win.orderFront(nil)

        // Subscribe to gaze point updates
        cancellable = gazeRouter.$currentGazePoint
            .receive(on: RunLoop.main)
            .sink { [weak self] point in
                self?.updateCursorPosition(point)
            }

        ConductorLog.component("gaze-cursor").info("Gaze cursor overlay started")
    }

    /// Stop and remove the overlay.
    func stop() {
        cancellable?.cancel()
        cancellable = nil
        window?.orderOut(nil)
        window = nil
        ConductorLog.component("gaze-cursor").info("Gaze cursor overlay stopped")
    }

    /// Whether the overlay is currently visible.
    var isActive: Bool { window != nil }

    // MARK: - Position Update

    private func updateCursorPosition(_ point: CGPoint?) {
        guard let point = point, let screen = NSScreen.main else {
            cursorView?.rootView = GazeCursorView(visible: false)
            return
        }

        // Convert from top-left origin (gaze) to bottom-left origin (AppKit)
        let flippedY = screen.frame.height - point.y
        let origin = CGPoint(
            x: point.x - cursorSize / 2,
            y: flippedY - cursorSize / 2
        )

        cursorView?.rootView = GazeCursorView(
            visible: true,
            position: origin,
            size: cursorSize
        )
    }
}

// MARK: - Cursor View

/// A simple colored dot rendered at the gaze position.
struct GazeCursorView: View {
    var visible: Bool = false
    var position: CGPoint = .zero
    var size: CGFloat = 20

    var body: some View {
        if visible {
            Canvas { context, canvasSize in
                let rect = CGRect(
                    x: position.x,
                    y: canvasSize.height - position.y - size,
                    width: size,
                    height: size
                )
                context.fill(
                    Path(ellipseIn: rect),
                    with: .color(.cyan.opacity(0.6))
                )
                // Outer ring
                context.stroke(
                    Path(ellipseIn: rect.insetBy(dx: -2, dy: -2)),
                    with: .color(.cyan.opacity(0.3)),
                    lineWidth: 2
                )
            }
            .allowsHitTesting(false)
        }
    }
}
