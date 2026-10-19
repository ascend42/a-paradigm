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
let H64 = "sha256:" + String(repeating: "a", count: 64)
func voicePreimage(arm: String = arm1, human: String = "conn:h", voice: String = "conn:v") -> String {
    ["gnomon:approve-voice:v1", "gnomon:voice-decision:v1", "card:01HZZZZZZZZZZZZZZZZZZZZZZZ", "allow", H64, "p:abcdefgh/matt", arm, human, voice, "turn:1", H64, "-", "-", "-", "-", "-"].joined(separator: "\n")
}
let voiceMsg = b64(voicePreimage())
let handMsg = b64("gnomon:approve:v1\ncard:x\nallow\nsha256:00\nhuman:me")

func errorCode(_ body: () throws -> Any) -> String? {
    do { _ = try body(); return nil } catch let e as HelperError { return e.code } catch { return "other" }
}

final class DomainTests: XCTestCase {
    func testVoiceDomainRefusedUnderConnIdUnlock() {
        let s = testServer()
        // cached (connId unlock) and fresh both refuse the voice domain before any key or unlock is touched
        XCTAssertEqual(errorCode { try s.handle(["op": "sign", "key": "approvals", "gen": "test0001", "mode": "cached", "connId": "conn:a", "messages": [voiceMsg]]) }, "domain-refused")
        XCTAssertEqual(errorCode { try s.handle(["op": "sign", "key": "approvals", "gen": "test0001", "mode": "fresh", "connId": "conn:a", "reason": "r", "messages": [voiceMsg]]) }, "domain-refused")
        XCTAssertFalse(KeyClass.cachedDomains.contains("gnomon:approve-voice:v1\n"))
        XCTAssertFalse(KeyClass.approvals.allowedDomains.contains("gnomon:approve-voice:v1\n"))
        XCTAssertFalse(KeyClass.root.allowedDomains.contains("gnomon:approve-voice:v1\n"))
    }

    func testHandDomainRefusedUnderArm() {
        let s = testServer()
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
        let s = testServer()
        let base: Json = ["op": "arm.open", "armId": arm1, "gen": "test0001", "humanConnId": "conn:h", "voiceConnId": "conn:v", "hardSeconds": 600, "maxSignatures": 5, "reason": "r", "messages": [handMsg]]
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
        let s = testServer()
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

// ── Aegis V5 review fixes (H1, M1, M2, M3, L1, L4) ─────────────────────────────

final class FakeProbe: SessionProbe {
    var ok: Bool
    init(_ ok: Bool) { self.ok = ok }
    func usable() -> Bool { ok }
}

/// A Server whose arm paths need no prompt and no Secure Enclave: presence returns a spy context, the signer a fake signature.
func testServer(probe: SessionProbe = FakeProbe(true), custody: Custody = Custody(),
                presence: ((String) throws -> LAContext)? = nil) -> Server {
    Server(custody: custody, presence: presence ?? { _ in SpyContext() }, signer: { _, _, _, msgs in msgs.map { _ in "c2ln" } }, session: probe)
}

func liveArm(_ s: Server, _ id: String = arm1, human: String = "conn:h", voice: String = "conn:v") -> SpyContext {
    let c = SpyContext()
    _ = s.custody.sync { s.custody.arms.put(id, gen: "test0001", humanConnId: human, voiceConnId: voice, ctx: c, hardSeconds: 600, idleSeconds: nil, maxSignatures: 10) }
    return c
}

func armSign(_ s: Server, _ msg: String, arm: String = arm1, human: String = "conn:h", voice: String = "conn:v") throws -> Json {
    try s.handle(["op": "arm.sign", "armId": arm, "gen": "test0001", "humanConnId": human, "voiceConnId": voice, "messages": [msg]])
}

let openReq: Json = ["op": "arm.open", "armId": arm1, "gen": "test0001", "humanConnId": "conn:h", "voiceConnId": "conn:v",
                     "hardSeconds": 600, "maxSignatures": 5, "reason": "Arm voice approvals", "messages": [handMsg]]

final class AegisFixTests: XCTestCase {
    func testH1PreimageMustNameThisArmAndPair() throws {
        let s = testServer()
        _ = liveArm(s)
        XCTAssertEqual(try armSign(s, voiceMsg)["armId"] as? String, arm1) // a matching preimage signs
        XCTAssertEqual(errorCode { try armSign(s, b64(voicePreimage(arm: arm2))) }, "preimage-refused") // a foreign armId
        XCTAssertEqual(errorCode { try armSign(s, b64(voicePreimage(human: "conn:x"))) }, "preimage-refused") // a foreign human
        XCTAssertEqual(errorCode { try armSign(s, b64(voicePreimage(voice: "conn:x"))) }, "preimage-refused") // a foreign voice
        XCTAssertEqual(errorCode { try armSign(s, b64("gnomon:approve-voice:v1\ncard:x\nallow")) }, "preimage-refused") // malformed
        XCTAssertEqual(errorCode { try armSign(s, b64(voicePreimage() + "\nextra")) }, "preimage-refused") // too many lines
        let badHash = voicePreimage().replacingOccurrences(of: "\nturn:1\n" + H64, with: "\nturn:1\nsha256:zz")
        XCTAssertEqual(errorCode { try armSign(s, b64(badHash)) }, "preimage-refused")
        // the request's pair must ALSO be the arm's: a self-consistent preimage for another pair finds no arm
        XCTAssertEqual(errorCode { try armSign(s, b64(voicePreimage(human: "conn:x")), human: "conn:x") }, "no-arm")
    }

    func testH1GoldenMatchesContracts() {
        // the same vector as packages/gnomon-contracts/test/voice-decision.test.ts (frozen layout)
        let golden = "gnomon:voice-decision:v1\ncard:01HZZZZZZZZZZZZZZZZZZZZZZZ\nallow\n" + H64 + "\np:abcdefgh/matt\n" + arm1
            + "\nconn:h\nconn:v\nturn:1\n" + H64 + "\n-\n-\n-\n-\n-"
        let d = parseVoiceDecision(Data(("gnomon:approve-voice:v1\n" + golden).utf8))
        XCTAssertEqual(d?.armId, arm1)
        XCTAssertEqual(d?.humanConnId, "conn:h")
        XCTAssertEqual(d?.voiceConnId, "conn:v")
    }

    func testM1FailClosedOnLockedOrUnknownSession() {
        let s = testServer(probe: FakeProbe(false))
        XCTAssertEqual(errorCode { try s.handle(openReq) }, "session-locked")
        XCTAssertEqual(s.custody.sync { s.custody.arms.count }, 0)
        let c = liveArm(s)
        XCTAssertEqual(errorCode { try armSign(s, voiceMsg) }, "no-arm")
        XCTAssertTrue(c.invalidated) // the arm was closed, not just skipped
        XCTAssertEqual(s.custody.sync { s.custody.arms.count }, 0)
    }

    func testM2MaxSignaturesRequired() {
        var r = openReq
        r.removeValue(forKey: "maxSignatures")
        XCTAssertEqual(errorCode { try testServer().handle(r) }, "bad-request")
        r["maxSignatures"] = Bounds.armMaxSignatures + 1
        XCTAssertEqual(errorCode { try testServer().handle(r) }, "bad-request")
    }

    func testM3HelperLineFirstAndReasonCapped() throws {
        var shown = ""
        let s = testServer(presence: { text in shown = text; return SpyContext() })
        _ = try s.handle(openReq)
        XCTAssertTrue(shown.hasPrefix("Gnomon Helper: voice arm \(arm1) binds human conn:h + voice conn:v"))
        XCTAssertTrue(shown.hasSuffix("\nArm voice approvals"))
        var r = openReq
        r["armId"] = arm2
        r["reason"] = String(repeating: "x", count: maxArmReasonChars + 1)
        XCTAssertEqual(errorCode { try s.handle(r) }, "bad-request")
    }

    func testL1SessionEventDuringPromptDiscardsTheArm() {
        let custody = Custody()
        let ctx = SpyContext()
        let s = testServer(custody: custody, presence: { _ in
            custody.invalidateAll() // the screen locks while the Touch ID dialog is up
            return ctx
        })
        XCTAssertEqual(errorCode { try s.handle(openReq) }, "arm-invalidated")
        XCTAssertTrue(ctx.invalidated)
        XCTAssertEqual(custody.sync { custody.arms.count }, 0)
    }

    func testL4Display() {
        XCTAssertEqual(displayDuration(45), "45 s")
        XCTAssertEqual(displayDuration(300), "5 min")
        XCTAssertEqual(displayDuration(90), "1 min 30 s")
        let long = "conn:" + String(repeating: "q", count: 60)
        XCTAssertEqual(displayConnId("conn:h"), "conn:h")
        XCTAssertTrue(displayConnId(long).hasPrefix("id#"))
        XCTAssertNotEqual(displayConnId(long), displayConnId(long + "r")) // never a shared truncation
        XCTAssertTrue(armLine(armId: arm1, humanConnId: "conn:h", voiceConnId: "conn:v", hardSeconds: 30, maxSignatures: 3).contains("up to 30 s, 3 voice decisions"))
    }
}
