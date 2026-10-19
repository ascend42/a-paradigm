import XCTest
@testable import VoiceIOCore

final class FrameCodecTests: XCTestCase {
    func testHeaderLayout() {
        let d = FrameCodec.encode(Frame(type: .json, payload: Data("{}".utf8)))
        XCTAssertEqual([UInt8](d), [0x01, 0x02, 0x00, 0x00, 0x00, 0x7B, 0x7D])
    }

    func testRoundTripThroughDecoderAcrossSplits() throws {
        let a = Frame(type: .json, payload: Data(#"{"op":"info","id":1}"#.utf8))
        let b = Frame(type: .playback, payload: FrameCodec.playbackPayload(sampleRate: 24_000, samples: [0, 1, -1, .max, .min]))
        let c = Frame(type: .json, payload: Data())
        let wire = FrameCodec.encode(a) + FrameCodec.encode(b) + FrameCodec.encode(c)
        for split in 0...wire.count {
            var dec = FrameDecoder()
            var got = try dec.push(wire.prefix(split))
            got += try dec.push(wire.suffix(from: split))
            XCTAssertEqual(got, [a, b, c], "split at \(split)")
            XCTAssertEqual(dec.bufferedBytes, 0)
        }
    }

    func testByteAtATime() throws {
        let f = Frame(type: .playback, payload: FrameCodec.playbackPayload(sampleRate: 16_000, samples: Array(repeating: 7, count: 100)))
        var dec = FrameDecoder()
        var got: [Frame] = []
        for byte in FrameCodec.encode(f) { got += try dec.push(Data([byte])) }
        XCTAssertEqual(got, [f])
    }

    func testUnknownTypeRefused() {
        var dec = FrameDecoder()
        XCTAssertThrowsError(try dec.push(Data([0x09, 0, 0, 0, 0]))) { XCTAssertEqual($0 as? FrameError, .unknownType(0x09)) }
    }

    func testOversizeRefusedBeforeBuffering() {
        var dec = FrameDecoder()
        let len = FrameCodec.maxPayload + 1
        let header = Data([0x03, UInt8(len & 0xFF), UInt8((len >> 8) & 0xFF), UInt8((len >> 16) & 0xFF), UInt8(len >> 24)])
        XCTAssertThrowsError(try dec.push(header)) { XCTAssertEqual($0 as? FrameError, .oversize(len)) }
    }

    func testMaxPayloadAccepted() throws {
        var dec = FrameDecoder()
        let f = Frame(type: .json, payload: Data(count: Int(FrameCodec.maxPayload)))
        XCTAssertEqual(try dec.push(FrameCodec.encode(f)).count, 1)
    }

    func testCapturePayloadRoundTrip() throws {
        let p = FrameCodec.capturePayload(hostTimeNs: 0x0102_0304_0506_0708, sampleRate: 16_000, samples: [1, -2, 300])
        XCTAssertEqual([UInt8](p.prefix(8)), [0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01])
        let (ns, rate, s) = try FrameCodec.decodeCapture(p)
        XCTAssertEqual(ns, 0x0102_0304_0506_0708)
        XCTAssertEqual(rate, 16_000)
        XCTAssertEqual(s, [1, -2, 300])
    }

    func testPlaybackPayloadChecks() throws {
        XCTAssertEqual(try FrameCodec.decodePlayback(FrameCodec.playbackPayload(sampleRate: 22_050, samples: [5, -5])).samples, [5, -5])
        // little-endian int16
        XCTAssertEqual([UInt8](FrameCodec.playbackPayload(sampleRate: 16_000, samples: [0x0102]).suffix(2)), [0x02, 0x01])
        XCTAssertThrowsError(try FrameCodec.decodePlayback(FrameCodec.playbackPayload(sampleRate: 96_000, samples: [1])))
        XCTAssertThrowsError(try FrameCodec.decodePlayback(FrameCodec.playbackPayload(sampleRate: 4_000, samples: [1])))
        XCTAssertThrowsError(try FrameCodec.decodePlayback(FrameCodec.playbackPayload(sampleRate: 16_000, samples: [])))
        XCTAssertThrowsError(try FrameCodec.decodePlayback(Data([0x80, 0x3E, 0, 0, 1]))) // odd sample bytes
    }

    func testJsonFrameIsSortedObject() throws {
        let d = FrameCodec.json(["b": 1, "a": "x"])
        var dec = FrameDecoder()
        let f = try dec.push(d)
        XCTAssertEqual(String(decoding: f[0].payload, as: UTF8.self), #"{"a":"x","b":1}"#)
    }
}
