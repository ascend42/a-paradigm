import Darwin
import XCTest
@testable import VoiceIOCore

/// A permission provider whose answer the test releases by hand (a TCC prompt left open).
private final class HeldPrompt {
    var pending: [(Bool) -> Void] = []
    var asked = 0
    lazy var provider: MicGate.PermissionProvider = { [unowned self] done in self.asked += 1; self.pending.append(done) }
    func answer(_ ok: Bool) { let p = pending; pending = []; p.forEach { $0(ok) } }
}

final class MicGateTests: XCTestCase {
    private let allowed: () -> (ok: Bool, reason: String) = { (true, "") }

    func testGrantedStarts() {
        let prompt = HeldPrompt()
        let gate = MicGate(provider: prompt.provider, disclaimAllowed: allowed)
        var got: [MicGateOutcome] = []
        gate.requestOn { got.append($0) }
        XCTAssertEqual(got, [])
        prompt.answer(true)
        XCTAssertEqual(got, [.start])
    }

    func testDenied() {
        let prompt = HeldPrompt()
        let gate = MicGate(provider: prompt.provider, disclaimAllowed: allowed)
        var got: [MicGateOutcome] = []
        gate.requestOn { got.append($0) }
        prompt.answer(false)
        XCTAssertEqual(got, [.denied])
    }

    /// M1: mic.off while the prompt is open wins; granting afterwards must not start the engine.
    func testMicOffDuringPromptWins() {
        let prompt = HeldPrompt()
        let gate = MicGate(provider: prompt.provider, disclaimAllowed: allowed)
        var got: [MicGateOutcome] = []
        gate.requestOn { got.append($0) }
        gate.off()
        prompt.answer(true)
        XCTAssertEqual(got, [.superseded])
    }

    /// Two mic.on in a row: only the newest may start.
    func testNewerRequestSupersedesOlder() {
        let prompt = HeldPrompt()
        let gate = MicGate(provider: prompt.provider, disclaimAllowed: allowed)
        var got: [String] = []
        gate.requestOn { got.append("first:\($0)") }
        gate.requestOn { got.append("second:\($0)") }
        prompt.answer(true)
        XCTAssertEqual(got, ["first:superseded", "second:start"])
    }

    /// M3: not disclaimed refuses before any prompt is shown.
    func testNotDisclaimedRefusesWithoutPrompt() {
        let prompt = HeldPrompt()
        let gate = MicGate(provider: prompt.provider, disclaimAllowed: { (false, "token-mismatch") })
        var got: [MicGateOutcome] = []
        gate.requestOn { got.append($0) }
        XCTAssertEqual(got, [.notDisclaimed("token-mismatch")])
        XCTAssertEqual(prompt.asked, 0)
    }
}

final class DisclaimTokenTests: XCTestCase {
    func testTokenShape() {
        let a = DisclaimToken.make(), b = DisclaimToken.make()
        XCTAssertTrue(DisclaimToken.wellFormed(a))
        XCTAssertNotEqual(a, b)
        XCTAssertFalse(DisclaimToken.wellFormed("1"))
        XCTAssertFalse(DisclaimToken.wellFormed(String(repeating: "G", count: 32)))
    }

    func testCheck() {
        let t = DisclaimToken.make()
        XCTAssertEqual(DisclaimToken.check(argvToken: t, envToken: t), .disclaimed)
        // a stray inherited env var without the argv token is ignored: the process re-spawns
        XCTAssertEqual(DisclaimToken.check(argvToken: nil, envToken: "1"), .fresh)
        XCTAssertEqual(DisclaimToken.check(argvToken: nil, envToken: t), .fresh)
        XCTAssertEqual(DisclaimToken.check(argvToken: t, envToken: nil), .mismatch)
        XCTAssertEqual(DisclaimToken.check(argvToken: t, envToken: DisclaimToken.make()), .mismatch)
        XCTAssertEqual(DisclaimToken.check(argvToken: "1", envToken: "1"), .mismatch) // the old "1" form never passes
    }
}

final class ParentWatchTests: XCTestCase {
    func testFiresWhenWatchedProcessExits() throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sleep")
        p.arguments = ["0.3"]
        try p.run()
        let fired = expectation(description: "exit seen")
        var seen: pid_t = 0
        let w = ParentWatch(pids: [p.processIdentifier]) { pid in seen = pid; fired.fulfill() }
        wait(for: [fired], timeout: 5)
        XCTAssertEqual(seen, p.processIdentifier)
        _ = w
    }

    func testFiresAtOnceForADeadPid() throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/true")
        try p.run()
        p.waitUntilExit() // reaped: the pid no longer exists
        var seen: pid_t = 0
        _ = ParentWatch(pids: [p.processIdentifier]) { seen = $0 }
        XCTAssertEqual(seen, p.processIdentifier)
    }

    func testReparentedToLaunchdFiresAtOnce() {
        var seen: pid_t = 0
        _ = ParentWatch(pids: [1]) { seen = $0 }
        XCTAssertEqual(seen, 1)
    }

    func testLiveParentDoesNotFire() {
        var fired = false
        let w = ParentWatch(pids: [getpid()]) { _ in fired = true }
        Thread.sleep(forTimeInterval: 0.2)
        XCTAssertFalse(fired)
        _ = w
    }
}
