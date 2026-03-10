// CalibrationWindowController.swift — #gaze-calibration
// Borderless fullscreen NSWindow hosting GazeCalibrationView.
// Provides a static async entry point for running the calibration overlay.

import AppKit
import SwiftUI

/// Manages a fullscreen calibration overlay window.
@MainActor
final class CalibrationWindowController {

    private var window: NSWindow?

    // MARK: - Public API

    /// Run the 5-point calibration overlay and return collected point pairs.
    /// Returns `nil` if the user cancels (ESC).
    static func run(gazeStream: AsyncStream<CGPoint>) async -> [(iris: CGPoint, screen: CGPoint)]? {
        let controller = CalibrationWindowController()
        return await controller.present(gazeStream: gazeStream)
    }

    // MARK: - Presentation

    private func present(gazeStream: AsyncStream<CGPoint>) async -> [(iris: CGPoint, screen: CGPoint)]? {
        guard let screen = NSScreen.main else {
            ConductorLog.component("gaze-calibration").error("No main screen available")
            return nil
        }

        return await withCheckedContinuation { continuation in
            let calibrationView = GazeCalibrationView(
                gazeStream: gazeStream,
                onComplete: { [weak self] result in
                    self?.dismiss()
                    continuation.resume(returning: result)
                }
            )

            let hostingView = NSHostingView(rootView: calibrationView)
            hostingView.frame = screen.frame

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
            win.ignoresMouseEvents = false
            win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            win.contentView = hostingView

            self.window = win

            ConductorLog.component("gaze-calibration").info("Presenting calibration overlay")
            win.makeKeyAndOrderFront(nil)
        }
    }

    private func dismiss() {
        window?.orderOut(nil)
        window = nil
        ConductorLog.component("gaze-calibration").info("Calibration overlay dismissed")
    }
}
