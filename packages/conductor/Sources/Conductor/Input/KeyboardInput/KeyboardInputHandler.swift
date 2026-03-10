// KeyboardInputHandler.swift — #keyboard-input
// NSTextField-based keyboard input that feeds into the BufferEngine.

import AppKit
import Combine

/// Handles keyboard input from the overlay's text field and routes it to the BufferEngine.
@MainActor
final class KeyboardInputHandler: NSObject, ObservableObject, NSTextFieldDelegate {
    private let buffer: BufferEngine

    /// Whether the input field is currently focused.
    @Published var isFocused: Bool = false

    init(buffer: BufferEngine) {
        self.buffer = buffer
        super.init()
    }

    // MARK: - NSTextFieldDelegate

    nonisolated func controlTextDidChange(_ notification: Notification) {
        guard let textField = notification.object as? NSTextField else { return }
        let newText = textField.stringValue
        Task { @MainActor in
            // Replace buffer contents with the text field value.
            // The text field is the source of truth for keyboard input.
            buffer.replace(with: newText)
        }
    }

    nonisolated func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        // Handle special keys
        if commandSelector == #selector(NSResponder.insertNewline(_:)) {
            // Enter key — do NOT insert newline, this is handled by dispatch
            return true
        }
        return false
    }
}
