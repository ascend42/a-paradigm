// LineFramer.swift — #claude-stream-session
// Frames a byte stream into complete newline-delimited JSON objects and decodes
// each into a StreamEvent. Buffers across feed() calls so multi-byte UTF-8 and
// partial lines never corrupt a decode. Sendable + thread-safe (locked).

import Foundation

/// Accumulates raw `Data` and emits decoded `StreamEvent`s for each complete line.
/// Safe to call from an off-main readabilityHandler.
final class LineFramer: @unchecked Sendable {

    private let lock = NSLock()
    /// Trailing bytes that did not yet end in a newline. Kept as bytes (NOT a
    /// String) because a UTF-8 codepoint may straddle two reads.
    private var buffer = Data()
    private let newline: UInt8 = 0x0A // "\n"
    private let decoder = JSONDecoder()

    /// Feed a chunk of stdout bytes. Returns decoded events for every COMPLETE
    /// line contained in the accumulated buffer. Lines that fail to decode are
    /// skipped (not thrown) so one bad line never breaks the stream.
    func feed(_ data: Data) -> [StreamEvent] {
        lock.lock()
        defer { lock.unlock() }

        buffer.append(data)

        var events: [StreamEvent] = []

        // Pull off every complete (newline-terminated) line.
        while let nlIndex = buffer.firstIndex(of: newline) {
            let lineData = buffer[buffer.startIndex..<nlIndex]
            // Drop the line plus the newline byte from the buffer.
            buffer.removeSubrange(buffer.startIndex...nlIndex)

            if lineData.isEmpty { continue }
            if let event = decodeLine(Data(lineData)) {
                events.append(event)
            }
        }

        return events
    }

    /// Decode any trailing buffered bytes as a final line (used on EOF).
    func flush() -> [StreamEvent] {
        lock.lock()
        defer { lock.unlock() }

        guard !buffer.isEmpty else { return [] }
        let remaining = buffer
        buffer.removeAll(keepingCapacity: false)

        if let event = decodeLine(Data(remaining)) {
            return [event]
        }
        return []
    }

    // MARK: - Private

    private func decodeLine(_ lineData: Data) -> StreamEvent? {
        // Tolerate whitespace-only fragments.
        let str = String(decoding: lineData, as: UTF8.self)
        guard !str.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        do {
            return try decoder.decode(StreamEvent.self, from: lineData)
        } catch {
            return nil
        }
    }
}
