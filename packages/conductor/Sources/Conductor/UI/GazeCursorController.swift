// GazeCursorController.swift — #gaze-cursor
// Transparent, click-through overlay showing gaze position and diagnostics.
// Toggle via Settings > Input > Gaze > "Show gaze cursor".

import AppKit
import Combine
import SwiftUI

/// Manages a borderless, click-through overlay window that renders the gaze cursor
/// with optional diagnostic information (raw vs calibrated, coordinates, accuracy).
@MainActor
final class GazeCursorController {

    private var window: NSWindow?
    private var cursorView: NSHostingView<GazeCursorView>?
    private var cancellables: Set<AnyCancellable> = []

    /// Size of the primary gaze cursor dot.
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

        // Subscribe to calibrated gaze point
        gazeRouter.$currentGazePoint
            .receive(on: RunLoop.main)
            .sink { [weak self] point in
                self?.updatePositions(calibrated: point, raw: gazeRouter.currentRawIrisPoint)
            }
            .store(in: &cancellables)

        // Subscribe to raw iris point
        gazeRouter.$currentRawIrisPoint
            .receive(on: RunLoop.main)
            .sink { [weak self] rawPoint in
                self?.updatePositions(calibrated: gazeRouter.currentGazePoint, raw: rawPoint)
            }
            .store(in: &cancellables)

        ConductorLog.component("gaze-cursor").info("Gaze cursor overlay started")
    }

    /// Stop and remove the overlay.
    func stop() {
        cancellables.removeAll()
        window?.orderOut(nil)
        window = nil
        ConductorLog.component("gaze-cursor").info("Gaze cursor overlay stopped")
    }

    /// Whether the overlay is currently visible.
    var isActive: Bool { window != nil }

    // MARK: - Position Update

    private func updatePositions(calibrated: CGPoint?, raw: CGPoint?) {
        guard let screen = NSScreen.main else { return }

        let calibratedOrigin: CGPoint?
        if let point = calibrated {
            // Gaze point is in AppKit screen coords (Y-up). Convert to window-local.
            let flippedY = screen.frame.height - point.y
            calibratedOrigin = CGPoint(
                x: point.x - cursorSize / 2,
                y: flippedY - cursorSize / 2
            )
        } else {
            calibratedOrigin = nil
        }

        let rawScreenOrigin: CGPoint?
        if let rawIris = raw {
            // Convert raw iris (0–1) to approximate screen position for debug display.
            // X mirrored (front camera), Y flipped (Vision Y-up → display Y-down).
            let screenX = (1.0 - rawIris.x) * screen.frame.width
            let screenY = rawIris.y * screen.frame.height  // Vision Y-up matches AppKit Y-up
            let flippedY = screen.frame.height - screenY
            rawScreenOrigin = CGPoint(
                x: screenX - 6,
                y: flippedY - 6
            )
        } else {
            rawScreenOrigin = nil
        }

        cursorView?.rootView = GazeCursorView(
            calibratedPosition: calibratedOrigin,
            rawPosition: rawScreenOrigin,
            calibratedSize: cursorSize,
            rawSize: 12,
            coordLabel: formatCoordLabel(calibrated: calibrated, raw: raw)
        )
    }

    private func formatCoordLabel(calibrated: CGPoint?, raw: CGPoint?) -> String? {
        guard let c = calibrated else { return nil }
        if let r = raw {
            return String(format: "gaze: (%d, %d)  iris: (%.2f, %.2f)", Int(c.x), Int(c.y), r.x, r.y)
        }
        return String(format: "gaze: (%d, %d)", Int(c.x), Int(c.y))
    }
}

// MARK: - Cursor View

/// Debug gaze visualization with calibrated dot, raw dot, and coordinate label.
struct GazeCursorView: View {
    /// Calibrated gaze position (window-local coords). Nil = hidden.
    var calibratedPosition: CGPoint? = nil
    /// Raw iris position mapped to approximate screen location. Nil = hidden.
    var rawPosition: CGPoint? = nil
    var calibratedSize: CGFloat = 20
    var rawSize: CGFloat = 12
    var coordLabel: String? = nil

    var body: some View {
        Canvas { context, canvasSize in
            // Raw iris dot (yellow, dimmer, smaller) — shows pre-calibration estimate
            if let raw = rawPosition {
                let rawRect = CGRect(
                    x: raw.x,
                    y: canvasSize.height - raw.y - rawSize,
                    width: rawSize,
                    height: rawSize
                )
                context.fill(
                    Path(ellipseIn: rawRect),
                    with: .color(.yellow.opacity(0.3))
                )
                context.stroke(
                    Path(ellipseIn: rawRect.insetBy(dx: -1, dy: -1)),
                    with: .color(.yellow.opacity(0.15)),
                    lineWidth: 1
                )
            }

            // Calibrated gaze dot (cyan, primary)
            if let cal = calibratedPosition {
                let calRect = CGRect(
                    x: cal.x,
                    y: canvasSize.height - cal.y - calibratedSize,
                    width: calibratedSize,
                    height: calibratedSize
                )
                context.fill(
                    Path(ellipseIn: calRect),
                    with: .color(.cyan.opacity(0.6))
                )
                context.stroke(
                    Path(ellipseIn: calRect.insetBy(dx: -2, dy: -2)),
                    with: .color(.cyan.opacity(0.3)),
                    lineWidth: 2
                )

                // Coordinate label near the dot
                if let label = coordLabel {
                    let labelX = cal.x + calibratedSize + 8
                    let labelY = canvasSize.height - cal.y - calibratedSize / 2 - 6
                    context.draw(
                        Text(label)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.6)),
                        at: CGPoint(x: labelX, y: labelY),
                        anchor: .leading
                    )
                }
            }
        }
        .allowsHitTesting(false)
    }
}
