// gnomon-helper 1.11.0 (G-HLP-04): the click key falsifiers. A CryptoKit software signer stands in for the
// non-permanent Secure Enclave key (one real-SE smoke test runs when the enclave is there).

import CryptoKit
import Foundation
import XCTest
@testable import gnomon_helper

final class SoftClick: ClickSigner {
    let k = P256.Signing.PrivateKey()
    var publicKey: Data { k.publicKey.x963Representation }
    func sign(_ message: Data) throws -> Data { try k.signature(for: message).derRepresentation }
}

private let rowHash = "sha256:" + String(repeating: "c", count: 64)
private let conn = "conn:01HZZZZZZZZZZZZZZZZZZZZZZA"
private func clickMsg(kind: String = "permission", cls: String = "reversible", decision: String = "allow") -> String {
    "gnomon:approve:v2\ncard:01HZZZZZZZZZZZZZZZZZZZZZZZ\n\(kind)\n\(cls)\n\(decision)\nsha256:\(String(repeating: "a", count: 64))\np:abcdefgh/matt"
}
private let approveMsg = clickMsg()

final class ClickRig {
    let probe = FixedCaller()
    let items = MemoryItemStore()
    let session = FakeProbe(true)
    var now = Date(timeIntervalSince1970: 1_800_000_000)
    lazy var custody = Custody(clicks: ClickKeys(now: { [unowned self] in self.now }))
    lazy var server = Server(custody: custody, session: session, caller: CallerGate(probe: probe, acceptDev: false), items: items, certKey: SoftCertKey(),
                             boot: { "BOOT-1" }, clock: { [unowned self] in self.now }, clickFactory: { SoftClick() })

    init(mode: String? = "off") {
        if let m = mode { try! ModeStore(items: items).store(StoredMode(mode: m, rowHash: m == "off" ? rowHash : nil, cardId: nil)) }
    }

    func call(_ req: Json) -> Json {
        (try? JSONSerialization.jsonObject(with: server.answer(try! JSONSerialization.data(withJSONObject: req)))) as? Json ?? [:]
    }

    func open(_ hash: String = rowHash, appBound: Bool = true) -> Json { call(["op": "click.open", "connId": conn, "appBound": appBound, "modeRowHash": hash]) }

    func sign(_ keyId: String?, _ msgs: [String] = [approveMsg], kind: String = "permission") -> Json {
        // Aegis S1 M1: a request cardKind is ignored; the preimage names the kind
        call(["op": "click.sign", "connId": conn, "keyId": keyId ?? "", "cardKind": kind, "messages": msgs.map { Data($0.utf8).base64EncodedString() }])
    }
}

final class ClickKeyTests: XCTestCase {
    func testOpenAndSignAnApproveDecisionThatVerifies() throws {
        let r = ClickRig()
        let o = r.open()
        XCTAssertEqual(o["ok"] as? Bool, true, "\(o)")
        let keyId = try XCTUnwrap(o["keyId"] as? String)
        XCTAssertTrue(keyId.hasPrefix("click:"))
        let s = r.sign(keyId)
        XCTAssertEqual(s["keyId"] as? String, keyId, "rows carry the click keyId")
        let sig = try XCTUnwrap(Data(base64Encoded: (s["sigs"] as? [String])?.first ?? ""))
        let pub = try P256.Signing.PublicKey(x963Representation: try XCTUnwrap(Data(base64Encoded: o["publicKey"] as! String)))
        XCTAssertTrue(pub.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: sig), for: Data(approveMsg.utf8)))
    }

    func testFailClosedOnTheMode() {
        XCTAssertEqual(ClickRig(mode: nil).open()["error"] as? String, "click-refused", "no item = Touch ID on")
        XCTAssertEqual(ClickRig(mode: "on").open()["error"] as? String, "click-refused")
        XCTAssertEqual(ClickRig().open("sha256:" + String(repeating: "d", count: 64))["error"] as? String, "click-refused", "another row hash")
        let r = ClickRig()
        r.items.unreadable.insert(presenceModeAccount)
        XCTAssertEqual(r.open()["error"] as? String, "keychain", "an unreadable mode issues nothing")
        let m = ClickRig()
        m.items.items[presenceModeAccount] = Data("{\"mode\":\"off\"}".utf8)
        XCTAssertEqual(m.open()["error"] as? String, "mode-unreadable", "OFF without its row hash")
        XCTAssertEqual(ClickRig().open(appBound: false)["error"] as? String, "click-refused")
        let l = ClickRig()
        l.session.ok = false
        XCTAssertEqual(l.open()["error"] as? String, "session-locked")
        let n = ClickRig()
        n.probe.f.matchedIdentifier = nil
        XCTAssertEqual(n.open()["error"] as? String, "caller-refused")
        XCTAssertEqual(n.custody.sync { n.custody.clicks.count }, 0)
    }

    func testClickSignRefusesEveryOtherDomainAndEveryRootCard() {
        let r = ClickRig()
        let id = r.open()["keyId"] as? String
        let v1 = "gnomon:approve:v1\ncard:01HZZZZZZZZZZZZZZZZZZZZZZZ\nallow\nsha256:\(String(repeating: "a", count: 64))\np:abcdefgh/matt"
        for m in ["gnomon:presence:v1\nmod.install\nsha256:00\nconn:x\nchallenge", "gnomon:approve-voice:v1\nx", "gnomon:row-sig:v1\n{}", "gnomon:approve:v1\n", v1, "anything"] {
            XCTAssertEqual(r.sign(id, [m])["error"] as? String, "domain-refused", m)
        }
        for k in ["install", "uninstall", "voice.enrol", "mod.mcp.config", "api-token", "peer-pair", "grant", "loop-trust", "local.config", "presence.mode", "kernel-custody", "log.quarantine"] {
            XCTAssertEqual(r.sign(id, [clickMsg(kind: k)], kind: "permission")["error"] as? String, "domain-refused", "the preimage's kind, not the request's: \(k)")
        }
        XCTAssertEqual(r.sign(id, [clickMsg(cls: "destructive", decision: "always")])["error"] as? String, "domain-refused", "a destructive always")
        XCTAssertEqual(r.sign(id, [clickMsg(cls: "irreversible", decision: "always")])["error"] as? String, "domain-refused")
        XCTAssertEqual(r.sign(id, [clickMsg(cls: "destructive")])["ok"] as? Bool, true, "a destructive allow is a click")
        XCTAssertEqual(r.sign(id, [approveMsg, "gnomon:row-sig:v1\n{}"])["error"] as? String, "domain-refused", "one bad message refuses the batch")
        XCTAssertEqual(r.sign(id)["ok"] as? Bool, true)
    }

    func testClickKeysDieOnPushCloseTwelveHoursAndModeOn() {
        // push: the observer invalidates before it writes
        let a = ClickRig()
        let ida = a.open()["keyId"] as? String
        var pushed: [Data] = []
        let watch = SessionWatch(custody: a.custody, source: FakeSource(), output: Output(sink: { pushed.append($0) }))
        watch.fired(.screenLock)
        XCTAssertEqual(pushed.count, 1)
        XCTAssertEqual(a.sign(ida)["error"] as? String, "no-click")
        // conn.close
        let b = ClickRig()
        let idb = b.open()["keyId"] as? String
        XCTAssertEqual(b.call(["op": "conn.close", "connId": conn])["click"] as? Bool, true)
        XCTAssertEqual(b.sign(idb)["error"] as? String, "no-click")
        // 12 h
        let c = ClickRig()
        let idc = c.open()["keyId"] as? String
        c.now = c.now.addingTimeInterval(Bounds.unlockAbsoluteSeconds)
        XCTAssertEqual(c.sign(idc)["error"] as? String, "no-click")
        // mode-on, no presence
        let d = ClickRig()
        let idd = d.open()["keyId"] as? String
        XCTAssertEqual((d.call(["op": "presence.mode.on"])["stored"]) as? Bool, true)
        XCTAssertEqual(d.sign(idd)["error"] as? String, "no-click")
        XCTAssertEqual(d.open()["error"] as? String, "click-refused", "and none opens again while on")
        // a locked session at sign time revokes too
        let e = ClickRig()
        let ide = e.open()["keyId"] as? String
        e.session.ok = false
        XCTAssertEqual(e.sign(ide)["error"] as? String, "no-click")
        e.session.ok = true
        XCTAssertEqual(e.sign(ide)["error"] as? String, "no-click")
    }

    func testSixtyAMinuteAnd512PerKey() {
        let r = ClickRig()
        let id = r.open()["keyId"] as? String
        for i in 0..<60 { XCTAssertEqual(r.sign(id)["ok"] as? Bool, true, "\(i)") }
        XCTAssertEqual(r.sign(id)["error"] as? String, "rate-limited")
        var signed = 60
        while signed < 512 {
            r.now = r.now.addingTimeInterval(60)
            for _ in 0..<min(60, 512 - signed) { XCTAssertEqual(r.sign(id)["ok"] as? Bool, true) }
            signed += min(60, 512 - signed)
        }
        r.now = r.now.addingTimeInterval(60)
        XCTAssertEqual(r.sign(id)["error"] as? String, "no-click", "512 per key")
    }

    func testAnotherConnectionOrKeyIdCannotUseIt() {
        let r = ClickRig()
        let id = r.open()["keyId"] as? String
        XCTAssertEqual(r.sign("click:" + String(repeating: "0", count: 32))["error"] as? String, "no-click")
        XCTAssertEqual(r.call(["op": "click.sign", "connId": "conn:other", "keyId": id!, "cardKind": "permission", "messages": [Data(approveMsg.utf8).base64EncodedString()]])["error"] as? String, "no-click")
    }

    /// Aegis S1 M1: the Swift rule equals the TS clickDecisionRefusal on every shared click-approve vector.
    func testSharedClickApproveVectors() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("gnomon-contracts/test/fixtures/click-approve-vectors.json")
        let doc = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? Json)
        let vs = try XCTUnwrap(doc["vectors"] as? [Json])
        XCTAssertGreaterThanOrEqual(vs.count, 20)
        for v in vs {
            let m = Data((v["message"] as! String).utf8)
            XCTAssertEqual(clickApproveRefusal(m), v["refused"] as? String, v["name"] as? String ?? "?")
        }
    }

    /// G-HLP-04: the click key's attributes and token blob are never read (S0 P2: a blob reloads in another process).
    func testTheBlobIsNeverExportedSourceGuard() throws {
        let src = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/gnomon-helper")
        let files = try FileManager.default.contentsOfDirectory(at: src, includingPropertiesForKeys: nil).filter { $0.pathExtension == "swift" }
        XCTAssertGreaterThan(files.count, 8)
        for f in files {
            let text = try String(contentsOf: f, encoding: .utf8)
            for banned in ["SecKeyCopyAttributes", "dataRepresentation", "\"toid\"", "kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: click"] {
                XCTAssertFalse(text.contains(banned), "\(f.lastPathComponent) uses \(banned)")
            }
        }
        // the click key is never permanent
        let click = try String(contentsOf: src.appendingPathComponent("ClickKey.swift"), encoding: .utf8)
        XCTAssertTrue(click.contains("kSecAttrIsPermanent as String: false"))
        XCTAssertFalse(click.contains("kSecAttrIsPermanent as String: true"))
        XCTAssertFalse(click.contains("SecItemAdd"))
    }

    func testARealEnclaveClickKeySignsAndIsNotInTheKeychain() throws {
        let k: EphemeralSEClickKey
        do { k = try EphemeralSEClickKey() } catch { throw XCTSkip("no Secure Enclave here: \(error)") }
        let sig = try k.sign(Data(approveMsg.utf8))
        let pub = try P256.Signing.PublicKey(x963Representation: k.publicKey)
        XCTAssertTrue(pub.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: sig), for: Data(approveMsg.utf8)))
    }
}
