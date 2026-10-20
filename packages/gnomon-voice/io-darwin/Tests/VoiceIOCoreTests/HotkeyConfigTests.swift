import XCTest
@testable import VoiceIOCore

final class HotkeyConfigTests: XCTestCase {
    func testDefaults() {
        let d = HotkeyConfig.defaults
        XCTAssertEqual(d.json, ["talk": "ctrl+alt+space", "mic-toggle": "ctrl+alt+m", "mode-toggle": "ctrl+alt+a", "hold-toggle": "ctrl+alt+h", "stop-speaking": "ctrl+alt+."])
        XCTAssertEqual(d.bindings[.talk]?.keyCode, 0x31)
        XCTAssertEqual(d.bindings[.talk]?.modifiers, HotkeySpec.controlKey | HotkeySpec.optionKey)
        XCTAssertEqual(d.bindings[.micToggle]?.keyCode, 0x2E)
        XCTAssertEqual(d.bindings[.modeToggle]?.keyCode, 0x00)
        XCTAssertEqual(d.bindings[.holdToggle]?.keyCode, 0x04)
        XCTAssertEqual(d.bindings[.holdToggle]?.modifiers, HotkeySpec.controlKey | HotkeySpec.optionKey)
        XCTAssertEqual(d.bindings[.stopSpeaking]?.keyCode, 0x2F)
        XCTAssertEqual(d.bindings[.stopSpeaking]?.modifiers, HotkeySpec.controlKey | HotkeySpec.optionKey)
    }

    func testPeriodKey() throws {
        XCTAssertEqual(try HotkeySpec.parse("ctrl+alt+period")?.canonical, "ctrl+alt+.")
        XCTAssertEqual(try HotkeySpec.parse("cmd+.")?.keyCode, 0x2F)
        XCTAssertThrowsError(try HotkeySpec.parse(".")) { XCTAssertEqual($0 as? HotkeyError, .needsModifier(".")) }
        // "period" and "." are the same chord, so binding both is a duplicate
        XCTAssertThrowsError(try HotkeyConfig.defaults.applying(["talk": "alt+ctrl+period"])) { XCTAssertEqual($0 as? HotkeyError, .duplicate("ctrl+alt+.")) }
    }

    func testParseSynonymsAndCanonicalOrder() throws {
        let a = try XCTUnwrap(HotkeySpec.parse("Command + Shift + K"))
        XCTAssertEqual(a.canonical, "shift+cmd+k")
        XCTAssertEqual(a.modifiers, HotkeySpec.cmdKey | HotkeySpec.shiftKey)
        XCTAssertEqual(try HotkeySpec.parse("opt+control+return")?.canonical, "ctrl+alt+return")
        XCTAssertEqual(try HotkeySpec.parse("f5")?.keyCode, 0x60)
        XCTAssertNil(try HotkeySpec.parse("none"))
    }

    func testParseRefusals() {
        XCTAssertThrowsError(try HotkeySpec.parse("space")) { XCTAssertEqual($0 as? HotkeyError, .needsModifier("space")) }
        XCTAssertThrowsError(try HotkeySpec.parse("shift+a")) { XCTAssertEqual($0 as? HotkeyError, .needsModifier("shift+a")) }
        XCTAssertThrowsError(try HotkeySpec.parse("ctrl+hyper+a")) { XCTAssertEqual($0 as? HotkeyError, .unknownModifier("hyper")) }
        XCTAssertThrowsError(try HotkeySpec.parse("ctrl+alt+é")) { XCTAssertEqual($0 as? HotkeyError, .unknownKey("é")) }
        XCTAssertThrowsError(try HotkeySpec.parse("ctrl++a"))
        XCTAssertThrowsError(try HotkeySpec.parse(""))
        XCTAssertThrowsError(try HotkeySpec.parse("ctrl+ctrl+a"))
    }

    func testPartialUpdateKeepsOthers() throws {
        let c = try HotkeyConfig.defaults.applying(["talk": "cmd+alt+t"])
        XCTAssertEqual(c.json["talk"], "alt+cmd+t")
        XCTAssertEqual(c.json["mic-toggle"], "ctrl+alt+m")
        let off = try c.applying(["mode-toggle": "none"])
        XCTAssertNil(off.bindings[.modeToggle])
        XCTAssertEqual(off.json["mode-toggle"], "none")
    }

    func testDuplicateAndUnknownActionRefused() {
        XCTAssertThrowsError(try HotkeyConfig.defaults.applying(["talk": "alt+ctrl+m"])) { XCTAssertEqual($0 as? HotkeyError, .duplicate("ctrl+alt+m")) }
        XCTAssertThrowsError(try HotkeyConfig.defaults.applying(["shout": "ctrl+alt+s"])) { XCTAssertEqual($0 as? HotkeyError, .unknownAction("shout")) }
        // swapping two bindings in one update is fine
        XCTAssertNoThrow(try HotkeyConfig.defaults.applying(["mic-toggle": "ctrl+alt+a", "mode-toggle": "ctrl+alt+m"]))
    }

    func testCarbonIds() {
        for a in HotkeyAction.allCases { XCTAssertEqual(HotkeyAction(carbonId: a.carbonId), a) }
        XCTAssertNil(HotkeyAction(carbonId: 99))
        XCTAssertEqual(HotkeyAction.holdToggle.carbonId, 4)
        XCTAssertEqual(HotkeyAction(rawValue: "hold-toggle"), .holdToggle)
        XCTAssertEqual(HotkeyAction.stopSpeaking.carbonId, 5)
        XCTAssertEqual(HotkeyAction(rawValue: "stop-speaking"), .stopSpeaking)
    }
}
