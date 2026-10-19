// gnomon-helper 1.6.0 unit tests (spec §14.7, S29-K5, G-BRK-06): no Secure Enclave, no prompt —
// every check here runs before a key is touched, or on the stores directly with spy contexts.

import Foundation
import LocalAuthentication
import XCTest
@testable import gnomon_helper

final class SpyContext: LAContext {
    var invalidated = false
    override func invalidate() {
        invalidated = true
        super.invalidate()
    }
}

let arm1 = "arm:01HZZZZZZZZZZZZZZZZZZZZZZZ"
let arm2 = "arm:01HZZZZZZZZZZZZZZZZZZZZZZY"
func armIdN(_ n: Int) -> String { "arm:01H" + String(repeating: "Z", count: 21) + String(format: "%02d", n) }
func b64(_ s: String) -> String { Data(s.utf8).base64EncodedString() }
let voiceMsg = b64("gnomon:approve-voice:v1\ncard:x\nallow\nsha256:00\nhuman:me")
let handMsg = b64("gnomon:approve:v1\ncard:x\nallow\nsha256:00\nhuman:me")

func errorCode(_ body: () throws -> Any) -> String? {
    do { _ = try body(); return nil } catch let e as HelperError { return e.code } catch { return "other" }
}

final class DomainTests: XCTestCase {
    func testVoiceDomainRefusedUnderConnIdUnlock() {
        let s = Server()
        // cached (connId unlock) and fresh both refuse the voice domain before any key or unlock is touched
        XCTAssertEqual(errorCode { try s.handle(["op": "sign", "key": "approvals", "gen": "test0001", "mode": "cached", "connId": "conn:a", "messages": [voiceMsg]]) }, "domain-refused")
        XCTAssertEqual(errorCode { try s.handle(["op": "sign", "key": "approvals", "gen": "test0001", "mode": "fresh", "connId": "conn:a", "reason": "r", "messages": [voiceMsg]]) }, "domain-refused")
        XCTAssertFalse(KeyClass.cachedDomains.contains("gnomon:approve-voice:v1\n"))
        XCTAssertFalse(KeyClass.approvals.allowedDomains.contains("gnomon:approve-voice:v1\n"))
        XCTAssertFalse(KeyClass.root.allowedDomains.contains("gnomon:approve-voice:v1\n"))
    }

    func testHandDomainRefusedUnderArm() {
        let s = Server()
        let req: Json = ["op": "arm.sign", "armId": arm1, "gen": "test0001", "humanConnId": "conn:h", "voiceConnId": "conn:v"]
        var r = req
        r["messages"] = [handMsg]
        XCTAssertEqual(errorCode { try s.handle(r) }, "domain-refused")
        r["messages"] = [b64("gnomon:presence:v1\nx")]
        XCTAssertEqual(errorCode { try s.handle(r) }, "domain-refused")
        r["messages"] = [voiceMsg]
        XCTAssertEqual(errorCode { try s.handle(r) }, "no-arm") // the right domain, but no live arm
        XCTAssertEqual(SignScope.arm.allowed(.root), [])
    }

    func testArmOpenValidatesBeforePrompt() {
        let s = Server()
        let base: Json = ["op": "arm.open", "armId": arm1, "gen": "test0001", "humanConnId": "conn:h", "voiceConnId": "conn:v", "hardSeconds": 600, "reason": "r", "messages": [handMsg]]
        var r = base; r["voiceConnId"] = "conn:h"
        XCTAssertEqual(errorCode { try s.handle(r) }, "bad-request") // same connection twice
        r = base; r["armId"] = "arm:nope"
        XCTAssertEqual(errorCode { try s.handle(r) }, "bad-request")
        r = base; r["hardSeconds"] = Bounds.armMaxHardSeconds + 1
        XCTAssertEqual(errorCode { try s.handle(r) }, "bad-request")
        r = base; r["hardSeconds"] = true
        XCTAssertEqual(errorCode { try s.handle(r) }, "bad-request")
        r = base; r["messages"] = [voiceMsg] // an arm prompt never signs a voice decision
        XCTAssertEqual(errorCode { try s.handle(r) }, "domain-refused")
        // full store: refused before the prompt
        for i in 0..<Bounds.maxArms {
            _ = s.custody.sync { s.custody.arms.put(armIdN(i), gen: "test0001", humanConnId: "conn:h\(i)", voiceConnId: "conn:v\(i)", ctx: SpyContext(), hardSeconds: 600, idleSeconds: nil, maxSignatures: 10) }
        }
        XCTAssertEqual(errorCode { try s.handle(base) }, "arm-limit")
    }
}

final class ArmStoreTests: XCTestCase {
    func testCapsAreIndependent() {
        let c = Custody()
        // fill the unlocks to their cap: arms still open
        for i in 0..<Bounds.maxUnlocks { XCTAssertTrue(c.unlocks.put("conn:u\(i)", gen: "test0001", ctx: SpyContext())) }
        XCTAssertFalse(c.unlocks.put("conn:extra", gen: "test0001", ctx: SpyContext()))
        for i in 0..<Bounds.maxArms {
            XCTAssertEqual(c.arms.put(armIdN(i), gen: "test0001", humanConnId: "conn:h", voiceConnId: "conn:v\(i)", ctx: SpyContext(), hardSeconds: 600, idleSeconds: nil, maxSignatures: 5), .ok)
        }
        XCTAssertEqual(c.arms.put(armIdN(99), gen: "test0001", humanConnId: "conn:h", voiceConnId: "conn:v", ctx: SpyContext(), hardSeconds: 600, idleSeconds: nil, maxSignatures: 5), .full)
        XCTAssertEqual(c.unlocks.count, Bounds.maxUnlocks)
        XCTAssertEqual(c.arms.count, Bounds.maxArms)
        // freeing arms frees no unlock slot, and the reverse
        c.arms.closeAll()
        XCTAssertFalse(c.unlocks.put("conn:extra", gen: "test0001", ctx: SpyContext()))
        XCTAssertNotEqual(Bounds.maxArms, Bounds.maxUnlocks)
    }

    func testArmBindingCapAndExpiry() {
        var t = Date(timeIntervalSince1970: 0)
        let a = Arms(now: { t })
        let ctx = SpyContext()
        XCTAssertEqual(a.put(arm1, gen: "g001", humanConnId: "conn:h", voiceConnId: "conn:v", ctx: ctx, hardSeconds: 60, idleSeconds: nil, maxSignatures: 2), .ok)
        XCTAssertEqual(a.put(arm1, gen: "g001", humanConnId: "conn:h", voiceConnId: "conn:v", ctx: SpyContext(), hardSeconds: 60, idleSeconds: nil, maxSignatures: 2), .exists)
        XCTAssertNil(a.use(arm1, gen: "g001", humanConnId: "conn:other", voiceConnId: "conn:v", signatures: 1)) // another pair
        XCTAssertNil(a.use(arm1, gen: "g002", humanConnId: "conn:h", voiceConnId: "conn:v", signatures: 1)) // another gen
        XCTAssertNotNil(a.use(arm1, gen: "g001", humanConnId: "conn:h", voiceConnId: "conn:v", signatures: 1))
        XCTAssertNil(a.use(arm1, gen: "g001", humanConnId: "conn:h", voiceConnId: "conn:v", signatures: 2)) // past the cap: closed
        XCTAssertTrue(ctx.invalidated)
        XCTAssertFalse(a.has(arm1))
        let ctx2 = SpyContext()
        _ = a.put(arm2, gen: "g001", humanConnId: "conn:h", voiceConnId: "conn:v", ctx: ctx2, hardSeconds: 60, idleSeconds: nil, maxSignatures: 9)
        t = t.addingTimeInterval(61)
        XCTAssertFalse(a.has(arm2)) // hard bound
        XCTAssertTrue(ctx2.invalidated)
    }

    func testCloseAllAndConnClose() throws {
        let s = Server()
        let c1 = SpyContext(), c2 = SpyContext(), c3 = SpyContext(), u = SpyContext()
        s.custody.sync {
            _ = s.custody.arms.put(armIdN(1), gen: "g001", humanConnId: "conn:h", voiceConnId: "conn:v", ctx: c1, hardSeconds: 600, idleSeconds: nil, maxSignatures: 5)
            _ = s.custody.arms.put(armIdN(2), gen: "g001", humanConnId: "conn:h2", voiceConnId: "conn:v", ctx: c2, hardSeconds: 600, idleSeconds: nil, maxSignatures: 5)
            _ = s.custody.arms.put(armIdN(3), gen: "g001", humanConnId: "conn:h3", voiceConnId: "conn:v3", ctx: c3, hardSeconds: 600, idleSeconds: nil, maxSignatures: 5)
            _ = s.custody.unlocks.put("conn:v", gen: "g001", ctx: u)
        }
        // closing a connId closes every arm that names it (human or voice side) and its unlock
        let r = try s.handle(["op": "conn.close", "connId": "conn:v"])
        XCTAssertEqual(r["arms"] as? [String], [armIdN(1), armIdN(2)])
        XCTAssertEqual(r["dropped"] as? Bool, true)
        XCTAssertTrue(c1.invalidated && c2.invalidated && u.invalidated)
        XCTAssertFalse(c3.invalidated)
        let all = try s.handle(["op": "arm.close-all"])
        XCTAssertEqual(all["closed"] as? Int, 1)
        XCTAssertTrue(c3.invalidated)
        XCTAssertEqual(s.custody.sync { s.custody.arms.count }, 0)
    }
}

final class FakeSource: SessionEventSource {
    var fire: ((SessionCause) -> Void)?
    func start(_ fire: @escaping (SessionCause) -> Void) { self.fire = fire }
    func stop() { fire = nil }
}

final class SessionWatchTests: XCTestCase {
    func testObserverInvalidatesEverythingThenPushes() throws {
        let custody = Custody()
        let a = SpyContext(), u = SpyContext()
        custody.sync {
            _ = custody.arms.put(arm1, gen: "g001", humanConnId: "conn:h", voiceConnId: "conn:v", ctx: a, hardSeconds: 600, idleSeconds: nil, maxSignatures: 5)
            _ = custody.unlocks.put("conn:h", gen: "g001", ctx: u)
        }
        var lines: [Data] = []
        var invalidatedBeforePush = false
        let out = Output(sink: { d in invalidatedBeforePush = a.invalidated && u.invalidated; lines.append(d) })
        let src = FakeSource()
        let watch = SessionWatch(custody: custody, source: src, output: out)
        let epoch0 = custody.epoch
        watch.start()
        src.fire?(.screenLock)
        XCTAssertTrue(invalidatedBeforePush)
        XCTAssertEqual(custody.sync { custody.arms.count + custody.unlocks.count }, 0)
        XCTAssertNotEqual(custody.epoch, epoch0) // a prompt that was up can never be kept
        XCTAssertEqual(lines.count, 1)
        let push = try XCTUnwrap(JSONSerialization.jsonObject(with: lines[0]) as? Json)
        XCTAssertEqual(push["push"] as? String, "session")
        XCTAssertEqual(push["cause"] as? String, "screen-lock")
        XCTAssertEqual(push["arms"] as? [String], [arm1])
        XCTAssertEqual(push["unlocks"] as? Int, 1)
        XCTAssertEqual(push["seq"] as? Int, 1)
        XCTAssertNil(push["id"])
        XCTAssertEqual(lines[0].last, 0x0A)
        src.fire?(.systemSleep) // nothing left: still pushed (the kernel drops any reference it kept)
        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(Set(SessionCause.allCases.map(\.rawValue)), ["screen-lock", "screensaver", "display-sleep", "system-sleep", "user-switch"])
    }

    func testVersionAndProtocol() {
        XCTAssertEqual(gnomonHelperVersion, "1.6.0")
        XCTAssertEqual(helperProtocol, "gnomon-helper:v2")
    }
}
