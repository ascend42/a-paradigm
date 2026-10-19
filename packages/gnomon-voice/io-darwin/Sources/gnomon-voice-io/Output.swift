// stdout writer and monotonic clock (#gnomon-voice-io). Every frame goes
// through one lock so capture frames, replies and events never interleave.
// Diagnostics go to stderr as plain lines (the kernel logs them).

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

final class Output {
    static let shared = Output()
    private let lock = NSLock()
    private var broken = false

    func write(_ bytes: Data) {
        lock.lock()
        defer { lock.unlock() }
        if broken { return }
        var ok = true
        bytes.withUnsafeBytes { raw in
            var off = 0
            while off < raw.count {
                let n = Darwin.write(STDOUT_FILENO, raw.baseAddress! + off, raw.count - off)
                if n < 0 {
                    if errno == EINTR { continue }
                    ok = false
                    return
                }
                off += n
            }
        }
        if !ok {
            // the reader is gone: nothing more to say, and stdin EOF will end us
            broken = true
        }
    }

    func json(_ obj: [String: Any]) { write(FrameCodec.json(obj)) }

    func event(_ name: String, _ fields: [String: Any] = [:]) {
        var e = fields
        e["type"] = "event"
        e["event"] = name
        e["tUs"] = Clock.nowUs()
        json(e)
    }

    func capture(hostTimeNs: UInt64, samples: [Int16]) {
        write(FrameCodec.encode(Frame(type: .capture, payload: FrameCodec.capturePayload(hostTimeNs: hostTimeNs, sampleRate: 16_000, samples: samples))))
    }
}

func diag(_ s: String) {
    FileHandle.standardError.write(Data("gnomon-voice-io: \(s)\n".utf8))
}
