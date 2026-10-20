import XCTest
@testable import VoiceIOCore

final class CommandParserTests: XCTestCase {
    private func parse(_ s: String) throws -> (RequestId, Command) {
        let r = try CommandParser.parse(Data(s.utf8))
        return (r.id, r.command)
    }

    private func code(_ s: String) -> String? {
        do { _ = try parse(s); return nil } catch let e as CommandError { return e.code } catch { return "other" }
    }

    func testSimpleOps() throws {
        let cases: [(String, Command)] = [
            ("info", .info), ("mic.on", .micOn), ("mic.off", .micOff), ("play.stop", .playStop),
            ("play.end", .playEnd), ("route.get", .routeGet), ("quit", .quit),
        ]
        for (op, cmd) in cases {
            let (id, c) = try parse(#"{"op":"\#(op)","id":7}"#)
            XCTAssertEqual(c, cmd)
            XCTAssertEqual(c.op, op)
            XCTAssertEqual(id, .int(7))
        }
    }

    func testIds() throws {
        XCTAssertEqual(try parse(#"{"op":"info"}"#).0, RequestId.none)
        XCTAssertEqual(try parse(#"{"op":"info","id":null}"#).0, RequestId.none)
        XCTAssertEqual(try parse(#"{"op":"info","id":"abc"}"#).0, .string("abc"))
        XCTAssertEqual(code(#"{"op":"info","id":true}"#), "bad-request")
        XCTAssertEqual(code(#"{"op":"info","id":1.5}"#), "bad-request")
        XCTAssertEqual(code(#"{"op":"info","id":{"x":1}}"#), "bad-request")
        XCTAssertEqual(code(#"{"op":"info","id":"\#(String(repeating: "x", count: 200))"}"#), "bad-request")
    }

    func testMalformed() {
        XCTAssertEqual(code("not json"), "bad-json")
        XCTAssertEqual(code("[1,2]"), "bad-json")
        XCTAssertEqual(code(#"{"id":1}"#), "bad-request")
        XCTAssertEqual(code(#"{"op":5}"#), "bad-request")
        XCTAssertEqual(code(#"{"op":"mic.maybe"}"#), "unknown-op")
    }

    func testUnknownOpEchoesId() {
        do { _ = try parse(#"{"op":"nope","id":"r1"}"#); XCTFail("must throw") } catch let e as CommandError {
            XCTAssertEqual(e.id, .string("r1"))
            XCTAssertEqual(e.op, "nope")
            let r = CommandParser.errorReply(e)
            XCTAssertEqual(r["ok"] as? Bool, false)
            XCTAssertEqual(r["id"] as? String, "r1")
            XCTAssertEqual(r["type"] as? String, "reply")
        } catch { XCTFail("\(error)") }
    }

    func testHotkeysSet() throws {
        let (_, c) = try parse(#"{"op":"hotkeys.set","bindings":{"talk":"cmd+shift+space","mode-toggle":"none"}}"#)
        XCTAssertEqual(c, .hotkeysSet(["talk": "cmd+shift+space", "mode-toggle": "none"]))
        XCTAssertEqual(code(#"{"op":"hotkeys.set"}"#), "bad-request")
        XCTAssertEqual(code(#"{"op":"hotkeys.set","bindings":{}}"#), "bad-request")
        XCTAssertEqual(code(#"{"op":"hotkeys.set","bindings":{"talk":3}}"#), "bad-request")
        XCTAssertEqual(code(#"{"op":"hotkeys.set","bindings":{"talk":"space"}}"#), "bad-request")
        XCTAssertEqual(code(#"{"op":"hotkeys.set","bindings":{"shout":"ctrl+alt+s"}}"#), "bad-request")
    }

    func testReplyShape() {
        let r = CommandParser.reply(id: .int(3), op: "info", fields: ["version": "0.1.0"])
        XCTAssertEqual(r["type"] as? String, "reply")
        XCTAssertEqual(r["ok"] as? Bool, true)
        XCTAssertEqual(r["id"] as? Int, 3)
        XCTAssertEqual(r["op"] as? String, "info")
        XCTAssertEqual(r["version"] as? String, "0.1.0")
    }
}
