// GestureConfirmationController.swift — #gesture-confirmation
// Transparent, click-through overlay showing a top-center toast when a gesture is recognized.
// Toggle via Settings > Input > Gestures > "Show gesture confirmation".

import AppKit
import Combine
import SwiftUI

/// Manages a borderless overlay window that shows recognized gesture toasts at top-center.
@MainActor
final class GestureConfirmationController {

    private var window: NSWindow?
    private var hostingView: NSHostingView<GestureConfirmationOverlay>?
    private var cancellable: AnyCancellable?
    private var dismissTask: Task<Void, Never>?

    // MARK: - Lifecycle

    /// Start observing recognized gestures from the orchestrator.
    func start(orchestrator: InputOrchestrator) {
        guard window == nil, let screen = NSScreen.main else { return }

        let overlay = GestureConfirmationOverlay()
        let hosting = NSHostingView(rootView: overlay)

        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: screen.frame.width, height: 120),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )

        // Position at top-center of screen
        let winX = screen.frame.midX - screen.frame.width / 2
        let winY = screen.frame.maxY - 140
        win.setFrameOrigin(NSPoint(x: winX, y: winY))

        win.level = .screenSaver
        win.isOpaque = false
        win.backgroundColor = .clear
        win.hasShadow = false
        win.ignoresMouseEvents = true
        win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        win.contentView = hosting

        self.window = win
        self.hostingView = hosting
        win.orderFront(nil)

        // Subscribe to recognized gestures
        cancellable = orchestrator.$lastRecognizedGesture
            .compactMap { $0 }
            .receive(on: RunLoop.main)
            .sink { [weak self] gesture in
                self?.showGesture(gesture)
            }

        ConductorLog.component("gesture-confirmation").info("Gesture confirmation overlay started")
    }

    /// Stop and remove the overlay.
    func stop() {
        cancellable?.cancel()
        cancellable = nil
        dismissTask?.cancel()
        dismissTask = nil
        window?.orderOut(nil)
        window = nil
        hostingView = nil
        ConductorLog.component("gesture-confirmation").info("Gesture confirmation overlay stopped")
    }

    /// Whether the overlay is currently active.
    var isActive: Bool { window != nil }

    // MARK: - Display

    private func showGesture(_ gesture: RecognizedGesture) {
        hostingView?.rootView = GestureConfirmationOverlay(
            gesture: gesture,
            visible: true
        )

        // Auto-dismiss after 1.5 seconds
        dismissTask?.cancel()
        dismissTask = Task {
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            self.hostingView?.rootView = GestureConfirmationOverlay()
        }
    }
}

// MARK: - Overlay View

/// Top-center toast showing the recognized gesture and its action.
struct GestureConfirmationOverlay: View {
    var gesture: RecognizedGesture? = nil
    var visible: Bool = false

    var body: some View {
        HStack {
            Spacer()
            if visible, let gesture {
                toastContent(gesture)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            Spacer()
        }
        .animation(.easeInOut(duration: 0.25), value: visible)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.top, 12)
    }

    private func toastContent(_ gesture: RecognizedGesture) -> some View {
        HStack(spacing: 10) {
            sourceIcon(gesture.source)
                .font(.system(size: 18))
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 1) {
                Text(gesture.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Text(friendlyActionName(gesture.actionName))
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, .dark)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(sourceColor(gesture.source).opacity(0.4), lineWidth: 1)
        )
    }

    @ViewBuilder
    private func sourceIcon(_ source: String) -> some View {
        switch source {
        case "gesture":
            Image(systemName: "hand.raised.fill")
                .foregroundStyle(.blue)
        case "custom":
            Image(systemName: "hand.draw.fill")
                .foregroundStyle(.purple)
        case "eyebrow":
            Image(systemName: "eyebrow")
                .foregroundStyle(.orange)
        case "voice":
            Image(systemName: "mic.fill")
                .foregroundStyle(.green)
        default:
            Image(systemName: "sparkles")
                .foregroundStyle(.cyan)
        }
    }

    private func sourceColor(_ source: String) -> Color {
        switch source {
        case "gesture": return .blue
        case "custom": return .purple
        case "eyebrow": return .orange
        case "voice": return .green
        default: return .cyan
        }
    }

    private func friendlyActionName(_ name: String) -> String {
        switch name {
        case "send": return "Send to target"
        case "undo": return "Undo"
        case "redo": return "Redo"
        case "deleteChar": return "Delete character"
        case "deleteWord": return "Delete word"
        case "cursorLeftChar": return "Cursor left"
        case "cursorLeftWord": return "Cursor left (word)"
        case "cursorRightChar": return "Cursor right"
        case "cursorRightWord": return "Cursor right (word)"
        case "voiceArm": return "Voice armed"
        case "voiceStart": return "Recording started"
        case "voiceStop": return "Recording stopped"
        case "toggleVideo": return "Toggle video"
        case "toggleVoice": return "Toggle voice"
        case "muteVideo": return "Video muted"
        case "muteVoice": return "Voice muted"
        case "unmuteVideo": return "Video unmuted"
        case "unmuteVoice": return "Voice unmuted"
        default:
            if name.hasPrefix("custom:") {
                return String(name.dropFirst(7))
            }
            return name
        }
    }
}
