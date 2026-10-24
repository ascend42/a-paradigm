// Frame codec of gnomon-voice-io:v1 (#gnomon-voice-io). Both directions use the
// same framing, so control and audio never interleave inside one byte stream:
//
//   frame   = type:u8  length:u32le  payload[length]        (length <= maxPayload)
//   0x01 json      UTF-8 JSON object. stdin: a command. stdout: a reply or an event.
//   0x02 capture   stdout only. hostTimeNs:u64le  sampleRate:u32le  samples:int16le[]
//                  16 kHz mono, after voice processing. hostTimeNs is the monotonic
//                  host clock (mach absolute time in ns) of the first sample.
//   0x03 playback  stdin only. sampleRate:u32le  samples:int16le[]   mono TTS PCM,
//                  any rate in 8000...48000, played through the capture engine.
//
// The decoder is streaming (push bytes, take whole frames) and refuses an unknown
// type or an oversize length before buffering the payload.

import Foundation

// Bump voiceIOVersion with EVERY security-relevant voice-io fix, and raise the kernel's floor with it
// (MIN_VOICE_IO_VERSION, packages/gnomon/src/kernel/voice/voice-install.ts): the floor is what refuses an older,
// still validly signed GnomonVoiceIO.app in a dev build (T-2026-10-21-028).
public let voiceIOVersion = "0.1.0"
public let voiceIOProtocol = "gnomon-voice-io:v1"

public enum FrameType: UInt8, Sendable {
    case json = 0x01
    case capture = 0x02
    case playback = 0x03
}

public struct Frame: Equatable, Sendable {
    public let type: FrameType
    public let payload: Data
    public init(type: FrameType, payload: Data) {
        self.type = type
        self.payload = payload
    }
}

public enum FrameError: Error, Equatable {
    case unknownType(UInt8)
    case oversize(UInt32)
    case badPayload(String)
}

public enum FrameCodec {
    /// 1 MiB: 32 s of 16 kHz Int16 audio, far above any sane chunk.
    public static let maxPayload: UInt32 = 1 << 20
    public static let headerSize = 5
    public static let minPlaybackRate: UInt32 = 8_000
    public static let maxPlaybackRate: UInt32 = 48_000

    public static func encode(_ frame: Frame) -> Data {
        var out = Data(capacity: headerSize + frame.payload.count)
        out.append(frame.type.rawValue)
        appendLE(&out, UInt32(frame.payload.count))
        out.append(frame.payload)
        return out
    }

    public static func json(_ object: [String: Any]) -> Data {
        // sortedKeys: deterministic bytes for tests and logs
        let body = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
        return encode(Frame(type: .json, payload: body))
    }

    public static func capturePayload(hostTimeNs: UInt64, sampleRate: UInt32, samples: [Int16]) -> Data {
        var out = Data(capacity: 12 + samples.count * 2)
        appendLE(&out, hostTimeNs)
        appendLE(&out, sampleRate)
        appendSamples(&out, samples)
        return out
    }

    public static func decodeCapture(_ payload: Data) throws -> (hostTimeNs: UInt64, sampleRate: UInt32, samples: [Int16]) {
        guard payload.count >= 12, (payload.count - 12) % 2 == 0 else { throw FrameError.badPayload("capture-length") }
        let b = [UInt8](payload)
        return (readLE64(b, 0), readLE32(b, 8), readSamples(b, from: 12))
    }

    public static func playbackPayload(sampleRate: UInt32, samples: [Int16]) -> Data {
        var out = Data(capacity: 4 + samples.count * 2)
        appendLE(&out, sampleRate)
        appendSamples(&out, samples)
        return out
    }

    public static func decodePlayback(_ payload: Data) throws -> (sampleRate: UInt32, samples: [Int16]) {
        guard payload.count >= 6, (payload.count - 4) % 2 == 0 else { throw FrameError.badPayload("playback-length") }
        let b = [UInt8](payload)
        let rate = readLE32(b, 0)
        guard rate >= minPlaybackRate, rate <= maxPlaybackRate else { throw FrameError.badPayload("playback-rate") }
        return (rate, readSamples(b, from: 4))
    }

    // MARK: little-endian helpers

    static func appendLE(_ d: inout Data, _ v: UInt32) {
        withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) }
    }
    static func appendLE(_ d: inout Data, _ v: UInt64) {
        withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) }
    }
    static func appendSamples(_ d: inout Data, _ s: [Int16]) {
        s.withUnsafeBufferPointer { buf in
            if Int16(littleEndian: 1) == 1 {
                d.append(UnsafeBufferPointer(start: UnsafeRawPointer(buf.baseAddress)?.assumingMemoryBound(to: UInt8.self), count: buf.count * 2))
            } else {
                for v in buf { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
            }
        }
    }
    static func readLE32(_ b: [UInt8], _ o: Int) -> UInt32 {
        UInt32(b[o]) | UInt32(b[o + 1]) << 8 | UInt32(b[o + 2]) << 16 | UInt32(b[o + 3]) << 24
    }
    static func readLE64(_ b: [UInt8], _ o: Int) -> UInt64 {
        UInt64(readLE32(b, o)) | UInt64(readLE32(b, o + 4)) << 32
    }
    static func readSamples(_ b: [UInt8], from o: Int) -> [Int16] {
        let n = (b.count - o) / 2
        var out = [Int16](repeating: 0, count: n)
        for i in 0..<n { out[i] = Int16(bitPattern: UInt16(b[o + 2 * i]) | UInt16(b[o + 2 * i + 1]) << 8) }
        return out
    }
}

/// Streaming decoder: push raw bytes, get whole frames. After a thrown error the
/// stream is out of sync and the caller must stop reading (the server exits).
public struct FrameDecoder {
    private var buffer = Data()
    public init() {}

    public var bufferedBytes: Int { buffer.count }

    public mutating func push(_ bytes: Data) throws -> [Frame] {
        buffer.append(bytes)
        var frames: [Frame] = []
        while buffer.count >= FrameCodec.headerSize {
            let start = buffer.startIndex
            let rawType = buffer[start]
            guard let type = FrameType(rawValue: rawType) else { throw FrameError.unknownType(rawType) }
            let len = UInt32(buffer[start + 1]) | UInt32(buffer[start + 2]) << 8 | UInt32(buffer[start + 3]) << 16 | UInt32(buffer[start + 4]) << 24
            guard len <= FrameCodec.maxPayload else { throw FrameError.oversize(len) }
            let total = FrameCodec.headerSize + Int(len)
            guard buffer.count >= total else { break }
            frames.append(Frame(type: type, payload: Data(buffer[(start + FrameCodec.headerSize)..<(start + total)])))
            buffer = Data(buffer[(start + total)...])
        }
        return frames
    }
}
