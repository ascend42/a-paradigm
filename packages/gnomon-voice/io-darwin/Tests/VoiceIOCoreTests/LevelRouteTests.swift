import XCTest
@testable import VoiceIOCore

final class LevelRouteTests: XCTestCase {
    func testRms() {
        XCTAssertEqual(Level.rmsDBFS([]), Level.floorDBFS)
        XCTAssertEqual(Level.rmsDBFS([0, 0, 0]), Level.floorDBFS)
        XCTAssertEqual(Level.rmsDBFS([.min, .min]), 0, accuracy: 1e-9)
        // a full-scale sine is -3.01 dBFS
        let sine = (0..<16_000).map { Int16(32767 * sin(2 * Double.pi * 1000 * Double($0) / 16_000)) }
        XCTAssertEqual(Level.rmsDBFS(sine), -3.01, accuracy: 0.02)
    }

    func testMeterWindowsAt15Hz() {
        var m = LevelMeter(sampleRate: 16_000, hz: 15)
        XCTAssertEqual(m.windowSamples, 1066)
        let r = m.feed(Array(repeating: 16_384, count: 16_000))
        XCTAssertEqual(r.count, 15)
        XCTAssertEqual(r[0].rms, -6.02, accuracy: 0.01)
        XCTAssertEqual(r[0].peak, -6.02, accuracy: 0.01)
    }

    func testRouteClassify() {
        XCTAssertEqual(RouteMath.classify(transport: "bltn", dataSource: "ispk"), .speakers)
        XCTAssertEqual(RouteMath.classify(transport: "bltn", dataSource: "hdpn"), .headphones)
        XCTAssertEqual(RouteMath.classify(transport: "bltn", dataSource: nil), .speakers)
        XCTAssertEqual(RouteMath.classify(transport: "blue", dataSource: nil), .headphones)
        XCTAssertEqual(RouteMath.classify(transport: "usb ", dataSource: nil), .external)
        XCTAssertEqual(RouteMath.classify(transport: nil, dataSource: nil), .unknown)
    }

    func testAecMode() {
        XCTAssertEqual(RouteMath.aec(kind: .headphones, voiceProcessing: false), .headphones)
        XCTAssertEqual(RouteMath.aec(kind: .headphones, voiceProcessing: true), .headphones)
        XCTAssertEqual(RouteMath.aec(kind: .speakers, voiceProcessing: true), .vpio)
        XCTAssertEqual(RouteMath.aec(kind: .speakers, voiceProcessing: false), AecMode.none)
        XCTAssertEqual(RouteMath.aec(kind: .external, voiceProcessing: false), AecMode.none)
    }

    func testFourCC() {
        XCTAssertEqual(RouteMath.fourCC(0x626C_746E), "bltn")
        XCTAssertEqual(RouteMath.fourCC(0x7573_6220), "usb ")
        XCTAssertEqual(RouteMath.fourCC(0x0000_0001), "????")
    }
}
