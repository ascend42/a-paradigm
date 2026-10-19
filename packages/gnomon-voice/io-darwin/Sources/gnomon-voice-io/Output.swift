// stdout writer and monotonic clock (#gnomon-voice-io). Every frame goes
// through one FIFO queue, so capture frames, replies and events never
// interleave. Diagnostics go to stderr as plain lines (the kernel logs them).

import Darwin
import Foundation
import VoiceIOCore

enum Clock {
    private static let timebase: mach_timebase_info_data_t = {
        var tb = mach_timebase_info_data_t()
        mach_timebase_info(&tb)
        return tb
    }()

    /// Host ticks (mach_absolute_time, AVAudioTime.hostTime) to ns.
    static func ns(fromHost ticks: UInt64) -> UInt64 {
        ticks / UInt64(timebase.denom) * UInt64(timebase.numer) + (ticks % UInt64(timebase.denom)) * UInt64(timebase.numer) / UInt64(timebase.denom)
    }

    static func nowNs() -> UInt64 { ns(fromHost: mach_absolute_time()) }

    /// Event timestamps: monotonic µs on the same clock as capture hostTimeNs (fits a JSON number for centuries).
    static func nowUs() -> UInt64 { nowNs() / 1_000 }
}

/// One writer thread drains a FIFO queue to stdout; producers never block on the
/// pipe and no lock is held during write(2) (Aegis L3). Control frames (replies,
/// events) are never dropped; capture frames are dropped while more than
/// `maxCaptureQueued` are waiting (the reader stalled), and the next accepted
/// capture is preceded by a `capture.dropped {frames}` event.
final class Output {
    static let shared = Output()
    static let maxCaptureQueued = 32 // about 2 s of 64 ms tap buffers

    private let cond = NSCondition()
    private var queue: [(data: Data, capture: Bool)] = []
    private var capturesQueued = 0
    private var dropped = 0
    private var broken = false
    private var writing = false

    private init() {
        let t = Thread { [unowned self] in self.drain() }
        t.name = "gnomon-voice-io.stdout"
        t.start()
    }

    private func enqueue(_ data: Data, capture: Bool) {
        cond.lock()
        defer { cond.unlock() }
        if broken { return }
        if capture {
            if capturesQueued >= Output.maxCaptureQueued { dropped += 1; return }
            if dropped > 0 {
                queue.append((Output.eventFrame("capture.dropped", ["frames": dropped]), false))
                dropped = 0
            }
            capturesQueued += 1
        }
        queue.append((data, capture))
        cond.signal()
    }

    private func drain() {
        while true {
            cond.lock()
            while queue.isEmpty { cond.wait() }
            let item = queue.removeFirst()
            if item.capture { capturesQueued -= 1 }
            writing = true
            cond.unlock()
            let ok = Output.writeAll(item.data) // no lock held while blocking
            cond.lock()
            writing = false
            if !ok {
                broken = true
                queue.removeAll()
                capturesQueued = 0
            }
            cond.broadcast()
            cond.unlock()
        }
    }

    /// Waits (bounded) until everything queued is written: called before exit.
    func flush(timeout: TimeInterval = 1.0) {
        let until = Date().addingTimeInterval(timeout)
        cond.lock()
        while (!queue.isEmpty || writing) && !broken {
            if !cond.wait(until: until) { break }
        }
        cond.unlock()
    }

    private static func writeAll(_ bytes: Data) -> Bool {
        bytes.withUnsafeBytes { raw -> Bool in
            var off = 0
            while off < raw.count {
                let n = Darwin.write(STDOUT_FILENO, raw.baseAddress! + off, raw.count - off)
                if n < 0 {
                    if errno == EINTR { continue }
                    return false // the reader is gone; stdin EOF or the parent watch ends us
                }
                off += n
            }
            return true
        }
    }

    private static func eventFrame(_ name: String, _ fields: [String: Any]) -> Data {
        var e = fields
        e["type"] = "event"
        e["event"] = name
        e["tUs"] = Clock.nowUs()
        return FrameCodec.json(e)
    }

    func json(_ obj: [String: Any]) { enqueue(FrameCodec.json(obj), capture: false) }

    func event(_ name: String, _ fields: [String: Any] = [:]) { enqueue(Output.eventFrame(name, fields), capture: false) }

    func capture(hostTimeNs: UInt64, samples: [Int16]) {
        enqueue(FrameCodec.encode(Frame(type: .capture, payload: FrameCodec.capturePayload(hostTimeNs: hostTimeNs, sampleRate: 16_000, samples: samples))), capture: true)
    }
}

func diag(_ s: String) {
    FileHandle.standardError.write(Data("gnomon-voice-io: \(s)\n".utf8))
}
