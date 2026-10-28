// TerminalLauncherEscapingTests.swift
// #terminal-launcher: a project path or window/session id spliced into
// AppleScript can never close the string literal and reach `do shell script`.

import XCTest
import Foundation
@testable import Conductor

final class TerminalLauncherEscapingTests: XCTestCase {

    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("tl-esc-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    /// Compile and run `return <literal>`; the result must be the original value.
    private func roundTrip(_ value: String) throws -> String? {
        let script = NSAppleScript(source: "return \(TerminalLauncher.appleScriptString(value))")
        var error: NSDictionary?
        let result = script?.executeAndReturnError(&error)
        if let error { XCTFail("AppleScript error: \(error)"); return nil }
        return result?.stringValue
    }

    func testHostileValuesRoundTripAsData() throws {
        let marker = dir.appendingPathComponent("PWNED").path
        let values = [
            "/tmp/a\" & (do shell script \"touch \(marker)\") & \"",
            "/tmp/back\\slash\\\" & (do shell script \"touch \(marker)\") & \"",
            "line\nbreak\rcarriage",
            "plain/path with spaces",
            // AppleScript also treats curly quotes as string delimiters.
            "/tmp/q\u{201D} & (do shell script \"touch \(marker)\") & \u{201C}",
            "/tmp/c\u{201C}open\u{201D} close",
            "/tmp/ls\u{2028}sep & (do shell script \"touch \(marker)\")",
            "/tmp/ps\u{2029}para",
            "/tmp/«data utxt0041» & (do shell script \"touch \(marker)\")",
            "«data utxt0041»",
        ]
        for value in values {
            XCTAssertEqual(try roundTrip(value), value)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker))
    }

    func testLaunchCommandForHostileProjectPathStaysOneLiteral() throws {
        let marker = dir.appendingPathComponent("PWNED2").path
        let project = "/tmp/p\" & (do shell script \"touch \(marker)\") & \"'$(touch \(marker))"
        let command = TerminalLauncher.launchCommand(projectDirectory: project)
        XCTAssertEqual(try roundTrip(command), command)
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker))
    }

    func testLiteralShape() {
        XCTAssertEqual(TerminalLauncher.appleScriptString("a\"b\\c"), "\"a\\\"b\\\\c\"")
    }
}
