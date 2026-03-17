// HotKeyRecorder.swift — #hotkey-recorder
// NSView-based key combination capture for custom hotkey assignment.

import AppKit
import SwiftUI

/// NSView that captures keyboard input for hotkey recording.
final class HotKeyRecorderNSView: NSView {
    var onRecord: ((HotKeyBinding) -> Void)?
    var isRecording: Bool = false {
        didSet {
            needsDisplay = true
            if isRecording {
                window?.makeFirstResponder(self)
            }
        }
    }

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        guard isRecording else {
            super.keyDown(with: event)
            return
        }

        let keyCode = UInt16(event.keyCode)
        let modifiers = HotKeyModifiers(from: CGEventFlags(rawValue: UInt64(event.modifierFlags.rawValue)))

        let binding = HotKeyBinding(keyCode: keyCode, modifiers: modifiers)
        onRecord?(binding)
        isRecording = false
    }

    override func draw(_ dirtyRect: NSRect) {
        let bg: NSColor = isRecording ? .controlAccentColor.withAlphaComponent(0.1) : .controlBackgroundColor
        bg.setFill()
        let path = NSBezierPath(roundedRect: bounds, xRadius: 4, yRadius: 4)
        path.fill()

        let border: NSColor = isRecording ? .controlAccentColor : .separatorColor
        border.setStroke()
        path.lineWidth = 1
        path.stroke()

        let text = isRecording ? "Press key combo..." : "Click to record"
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 10),
            .foregroundColor: NSColor.secondaryLabelColor
        ]
        let str = NSAttributedString(string: text, attributes: attrs)
        let size = str.size()
        let point = NSPoint(
            x: (bounds.width - size.width) / 2,
            y: (bounds.height - size.height) / 2
        )
        str.draw(at: point)
    }

    override func mouseDown(with event: NSEvent) {
        isRecording = true
    }
}

// MARK: - SwiftUI Wrapper

/// SwiftUI wrapper for the hotkey recorder NSView.
struct HotKeyRecorder: NSViewRepresentable {
    @Binding var isRecording: Bool
    var onRecord: (HotKeyBinding) -> Void

    func makeNSView(context: Context) -> HotKeyRecorderNSView {
        let view = HotKeyRecorderNSView()
        view.onRecord = { binding in
            onRecord(binding)
            isRecording = false
        }
        return view
    }

    func updateNSView(_ nsView: HotKeyRecorderNSView, context: Context) {
        nsView.isRecording = isRecording
    }
}
