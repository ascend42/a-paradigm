// EyebrowCalibrationWindowController.swift — #eyebrow-calibration
// Borderless fullscreen NSWindow hosting EyebrowCalibrationView.
// Mirrors CalibrationWindowController pattern for eyebrow threshold calibration.

import AppKit
import SwiftUI

/// Manages a fullscreen eyebrow calibration overlay window.
@MainActor
final class EyebrowCalibrationWindowController {

    private var window: NSWindow?

    // MARK: - Public API

    /// Run the 4-step eyebrow calibration overlay.
    /// Feeds real eyebrow frames from the gaze provider if available.
    static func run(
        eyebrowStream: AsyncStream<EyebrowFrame>?,
        onComplete: @escaping (Double, Double) -> Void
    ) async {
        let controller = EyebrowCalibrationWindowController()
        await controller.present(eyebrowStream: eyebrowStream, onComplete: onComplete)
    }

    // MARK: - Presentation

    private func present(
        eyebrowStream: AsyncStream<EyebrowFrame>?,
        onComplete: @escaping (Double, Double) -> Void
    ) async {
        guard let screen = NSScreen.main else {
            ConductorLog.component("eyebrow-calibration").error("No main screen available")
            return
        }

        let calibration = EyebrowCalibration()

        // Feed eyebrow frames to calibration if stream is available
        var feedTask: Task<Void, Never>?
        if let stream = eyebrowStream {
            feedTask = Task {
                for await frame in stream {
                    guard !Task.isCancelled else { break }
                    _ = calibration.processSample(frame)
                }
            }
        }

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let calibrationView = EyebrowCalibrationView(
                calibration: calibration,
                onComplete: { [weak self] raiseThreshold, lowerThreshold in
                    feedTask?.cancel()
                    self?.dismiss()
                    onComplete(raiseThreshold, lowerThreshold)
                    continuation.resume()
                },
                onCancel: { [weak self] in
                    feedTask?.cancel()
                    self?.dismiss()
                    continuation.resume()
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

            ConductorLog.component("eyebrow-calibration").info("Presenting eyebrow calibration overlay")
            win.makeKeyAndOrderFront(nil)
        }
    }

    private func dismiss() {
        window?.orderOut(nil)
        window = nil
        ConductorLog.component("eyebrow-calibration").info("Eyebrow calibration overlay dismissed")
    }
}
