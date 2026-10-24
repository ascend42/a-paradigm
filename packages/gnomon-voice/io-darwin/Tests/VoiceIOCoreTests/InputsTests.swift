import XCTest
@testable import VoiceIOCore

final class InputChoiceTests: XCTestCase {
    func testFollowsTheSystemDefaultWhenNothingIsChosen() {
        XCTAssertEqual(InputChoice.resolve(preferred: nil, available: ["builtin", "airpods"], systemDefault: "airpods"), InputResolution(uid: "airpods", missing: false))
    }

    func testAConnectedChoiceWins() {
        XCTAssertEqual(InputChoice.resolve(preferred: "builtin", available: ["builtin", "airpods"], systemDefault: "airpods"), InputResolution(uid: "builtin", missing: false))
    }

    /// the choice survives a disconnect: the default is used meanwhile and the choice is reported missing
    func testAMissingChoiceFallsBackToTheDefaultAndSaysSo() {
        XCTAssertEqual(InputChoice.resolve(preferred: "usb-mic", available: ["builtin", "airpods"], systemDefault: "airpods"), InputResolution(uid: "airpods", missing: true))
        // and comes back when the device does
        XCTAssertEqual(InputChoice.resolve(preferred: "usb-mic", available: ["builtin", "airpods", "usb-mic"], systemDefault: "airpods"), InputResolution(uid: "usb-mic", missing: false))
    }

    func testNoDefaultUsesTheFirstInputAndNoInputIsNil() {
        XCTAssertEqual(InputChoice.resolve(preferred: nil, available: ["builtin"], systemDefault: nil), InputResolution(uid: "builtin", missing: false))
        XCTAssertEqual(InputChoice.resolve(preferred: "x", available: [], systemDefault: nil), InputResolution(uid: nil, missing: true))
    }

    func testUIDShape() {
        XCTAssertTrue(InputChoice.wellFormedUID("BuiltInMicrophoneDevice"))
        XCTAssertTrue(InputChoice.wellFormedUID("30-7A-D2-65-33-13:input"))
        XCTAssertFalse(InputChoice.wellFormedUID(""))
        XCTAssertFalse(InputChoice.wellFormedUID(String(repeating: "x", count: 257)))
        XCTAssertFalse(InputChoice.wellFormedUID("a\nb"))
    }

    func testParser() throws {
        XCTAssertEqual(try CommandParser.parse(Data(#"{"op":"inputs.list","id":1}"#.utf8)).command, .inputsList)
        XCTAssertEqual(try CommandParser.parse(Data(#"{"op":"input.select","id":2,"device":"BuiltInMicrophoneDevice"}"#.utf8)).command, .inputSelect("BuiltInMicrophoneDevice"))
        XCTAssertEqual(try CommandParser.parse(Data(#"{"op":"input.select","id":3,"device":null}"#.utf8)).command, .inputSelect(nil))
        XCTAssertEqual(try CommandParser.parse(Data(#"{"op":"input.select","id":4}"#.utf8)).command, .inputSelect(nil))
        XCTAssertEqual(Command.inputSelect(nil).op, "input.select")
        XCTAssertThrowsError(try CommandParser.parse(Data(#"{"op":"input.select","id":5,"device":7}"#.utf8))) { e in
            XCTAssertEqual((e as? CommandError)?.code, "bad-request")
        }
        XCTAssertThrowsError(try CommandParser.parse(Data(#"{"op":"input.select","id":6,"device":""}"#.utf8)))
    }
}
