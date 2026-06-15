// AtriumSpikeWindow.swift — #atrium-thread
// The ATRIUM keystone spike window. Hosts AtriumThreadView and owns exactly ONE
// ClaudeStreamSession (single-owner pattern). On close, shuts the session down.
// Kicks off an initial turn so launching shows a live round-trip including a
// tool call.

import AppKit
import SwiftUI

@MainActor
final class AtriumSpikeWindow: NSWindow {

    /// The single owned stream session for this window.
    let session: ClaudeStreamSession

    /// Invoked after the window closes and its session is shut down, so the owner
    /// can drop its reference and a reopen builds a fresh window + session
    /// (avoids reusing a window whose claude process has already terminated).
    var onClose: (() -> Void)?

    /// Hardcoded project path for the spike — the conductor repo itself.
    private static let spikeProjectPath = "/Users/ascend/Documents/GitHub/a-paradigm"

    /// The opening turn that produces a visible round-trip (text + a tool call).
    private static let initialPrompt =
        "Say hello and tell me what project you're in, then list the files in the current directory."

    init() {
        self.session = ClaudeStreamSession(projectPath: Self.spikeProjectPath)

        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let width: CGFloat = 720
        let height: CGFloat = 720
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
        contentView = NSHostingView(rootView: AtriumThreadView(session: session))
        initialFirstResponder = contentView

        // Kick off the live round-trip. The session buffers this until system/init.
        session.start(initialPrompt: Self.initialPrompt)

        ConductorLog.component("atrium-thread")
            .info("ATRIUM spike window launched @ \(Self.spikeProjectPath)")
    }

    private func configure() {
        title = "ATRIUM"
        titleVisibility = .visible
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true
        isOpaque = true
        backgroundColor = NSColor(srgbRed: 0x0B / 255, green: 0x0E / 255, blue: 0x14 / 255, alpha: 1.0)
        hasShadow = true
        minSize = NSSize(width: 480, height: 480)
        isReleasedWhenClosed = false
        delegate = self
    }

    // An LSUIElement (accessory) app's programmatically-created window can be
    // treated as non-key by AppKit — especially with a transparent titlebar +
    // .fullSizeContentView. Forcing these true guarantees the window accepts key
    // status so the SwiftUI TextField can become first responder and take input.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

// MARK: - NSWindowDelegate

extension AtriumSpikeWindow: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        session.shutdown()
        ConductorLog.component("atrium-thread").info("ATRIUM spike window closing — session shut down")
        onClose?()
    }
}
