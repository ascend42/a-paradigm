// BufferEngine.swift — #text-buffer
// Staged text buffer with cursor, selection, undo/redo.
// Full implementation ships in Sprint 1.

import Foundation

/// The central text buffer where voice, gesture, and keyboard inputs converge.
/// Text stays here until dispatched to a Claude Code instance.
@MainActor
final class BufferEngine: ObservableObject {
    /// The current buffer text.
    @Published private(set) var text: String = ""

    /// Cursor position (character index).
    @Published private(set) var cursorPosition: Int = 0

    /// Undo stack.
    private var undoStack: [BufferSnapshot] = []

    /// Redo stack.
    private var redoStack: [BufferSnapshot] = []

    // MARK: - Editing

    /// Append text at the cursor position.
    func append(_ newText: String) {
        saveSnapshot()
        let index = text.index(text.startIndex, offsetBy: cursorPosition)
        text.insert(contentsOf: newText, at: index)
        cursorPosition += newText.count
    }

    /// Replace all buffer contents.
    func replace(with newText: String) {
        saveSnapshot()
        text = newText
        cursorPosition = newText.count
    }

    /// Delete backward from cursor.
    func deleteBackward(count: Int = 1) {
        guard cursorPosition > 0 else { return }
        saveSnapshot()
        let deleteCount = min(count, cursorPosition)
        let start = text.index(text.startIndex, offsetBy: cursorPosition - deleteCount)
        let end = text.index(text.startIndex, offsetBy: cursorPosition)
        text.removeSubrange(start..<end)
        cursorPosition -= deleteCount
    }

    /// Move cursor left.
    func moveCursorLeft(by count: Int = 1) {
        cursorPosition = max(0, cursorPosition - count)
    }

    /// Move cursor right.
    func moveCursorRight(by count: Int = 1) {
        cursorPosition = min(text.count, cursorPosition + count)
    }

    // MARK: - Undo / Redo

    func undo() {
        guard let snapshot = undoStack.popLast() else { return }
        redoStack.append(BufferSnapshot(text: text, cursorPosition: cursorPosition))
        text = snapshot.text
        cursorPosition = snapshot.cursorPosition
    }

    func redo() {
        guard let snapshot = redoStack.popLast() else { return }
        undoStack.append(BufferSnapshot(text: text, cursorPosition: cursorPosition))
        text = snapshot.text
        cursorPosition = snapshot.cursorPosition
    }

    // MARK: - Dispatch

    /// Flush the buffer and return its contents for dispatch.
    func flush() -> String {
        let flushed = text
        saveSnapshot()
        text = ""
        cursorPosition = 0
        return flushed
    }

    /// Whether the buffer has content to dispatch.
    var isEmpty: Bool { text.isEmpty }

    // MARK: - Private

    private func saveSnapshot() {
        undoStack.append(BufferSnapshot(text: text, cursorPosition: cursorPosition))
        redoStack.removeAll()
        // Limit undo depth
        if undoStack.count > 100 {
            undoStack.removeFirst()
        }
    }
}

/// Snapshot of buffer state for undo/redo.
private struct BufferSnapshot {
    let text: String
    let cursorPosition: Int
}
