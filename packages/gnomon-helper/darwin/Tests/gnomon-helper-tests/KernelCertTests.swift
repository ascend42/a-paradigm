// gnomon-helper 1.11.0 (G-HLP-03): kernel.cert and the anchor. No Secure Enclave and no keychain: a CryptoKit
// software key and MemoryItemStore stand in through the Server seams.

import CryptoKit
import Foundation
import XCTest
@testable import gnomon_helper

final class SoftCertKey: CertKey {
    let k = P256.Signing.PrivateKey()
    var signs = 0
    func publicKey() throws -> Data { k.publicKey.x963Representation }
    func sign(_ message: Data) throws -> Data {
        signs += 1
        return try k.signature(for: message).derRepresentation
    }
}

let pem = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=\n-----END PUBLIC KEY-----"
let logA = "log:01HZZZZZZZZZZZZZZZZZZZZZZA"
let logB = "log:01HZZZZZZZZZZZZZZZZZZZZZZB"
func kid(_ p: String) -> String { "gkey:v1:" + hex(Data(SHA256.hash(data: Data(p.utf8)))) }

final class Rig11 {
    let probe = FixedCaller()
    let items = MemoryItemStore()
    let key = SoftCertKey()
    var now = Date(timeIntervalSince1970: 1_800_000_000)
    var boot = "BOOT-1"
    lazy var server = Server(session: FakeProbe(true), caller: CallerGate(probe: probe, acceptDev: false), items: items, certKey: key,
                             boot: { [unowned self] in self.boot }, clock: { [unowned self] in self.now })

    func call(_ req: Json) -> Json {
        (try? JSONSerialization.jsonObject(with: server.answer(try! JSONSerialization.data(withJSONObject: req)))) as? Json ?? [:]
    }

    func cert(_ log: String = logA) -> Json { call(["op": "kernel.cert", "kernelKeyId": kid(pem), "pub": pem, "logId": log]) }
}

final class KernelCertTests: XCTestCase {
    func testTheKernelGetsACertBoundToItsInstanceBootAndLog() throws {
        let r = Rig11()
        let out = r.cert()
        XCTAssertEqual(out["ok"] as? Bool, true, "\(out)")
        let msg = try XCTUnwrap(Data(base64Encoded: out["cert"] as! String))
        let sig = try XCTUnwrap(Data(base64Encoded: out["sig"] as! String))
        let pub = try XCTUnwrap(Data(base64Encoded: out["certKey"] as! String))
        XCTAssertEqual(out["certKeyId"] as? String, certKeyId(pub))
        XCTAssertTrue(msg.starts(with: Data("gnomon:kernel-cert:v1\n".utf8)))
        let row = try XCTUnwrap(try JSONSerialization.jsonObject(with: msg.dropFirst(22)) as? Json)
        XCTAssertEqual(row["schemaVersion"] as? String, "gnomon-kernel-cert:v1")
        XCTAssertEqual(row["pid"] as? Int, 4242)
        XCTAssertEqual(row["pidVersion"] as? Int, 7)
        XCTAssertEqual(row["callerCdhash"] as? String, String(repeating: "ab", count: 20))
        XCTAssertEqual(row["boot"] as? String, "BOOT-1")
        XCTAssertEqual(row["kernelKeyId"] as? String, kid(pem))
        XCTAssertEqual(row["expiresAt"] as? String, isoMs(r.now.addingTimeInterval(24 * 3600)))
        XCTAssertNil(kernelCertRefusal(message: msg, signature: sig, certKey: pub, boot: "BOOT-1", logId: logA, now: r.now))
    }

    func testACertReplayedAcrossBootsOrLogsOrAfterExpiryIsRefused() throws {
        let r = Rig11()
        let out = r.cert()
        let msg = Data(base64Encoded: out["cert"] as! String)!, sig = Data(base64Encoded: out["sig"] as! String)!, pub = Data(base64Encoded: out["certKey"] as! String)!
        XCTAssertNotNil(kernelCertRefusal(message: msg, signature: sig, certKey: pub, boot: "BOOT-2", logId: logA, now: r.now), "another boot")
        XCTAssertNotNil(kernelCertRefusal(message: msg, signature: sig, certKey: pub, boot: "BOOT-1", logId: logB, now: r.now), "another log")
        XCTAssertNotNil(kernelCertRefusal(message: msg, signature: sig, certKey: pub, boot: "BOOT-1", logId: logA, now: r.now.addingTimeInterval(24 * 3600 + 1)), "expired")
        var tampered = msg
        tampered[tampered.count - 2] ^= 1
        XCTAssertNotNil(kernelCertRefusal(message: tampered, signature: sig, certKey: pub, boot: "BOOT-1", logId: logA, now: r.now), "not signed")
        XCTAssertNotNil(kernelCertRefusal(message: msg, signature: sig, certKey: SoftCertKey().k.publicKey.x963Representation, boot: "BOOT-1", logId: logA, now: r.now), "another cert key")
    }

    func testANonKernelCallerGetsNoCertAndNoSignature() {
        let r = Rig11()
        r.probe.f.matchedIdentifier = nil
        let out = r.cert()
        XCTAssertEqual(out["error"] as? String, "caller-refused")
        XCTAssertEqual(r.key.signs, 0)
        let r2 = Rig11()
        r2.probe.f.adhoc = true
        XCTAssertEqual(r2.cert()["error"] as? String, "caller-refused")
        let r3 = Rig11()
        r3.probe.f.stamp = KernelStamp(profile: "release", version: "8.0.0")
        XCTAssertEqual(r3.cert()["error"] as? String, "caller-refused", "an older kernel")
    }

    func testOneKernelKeyPerHelperAndAKeyIdThatMatchesThePem() {
        let r = Rig11()
        XCTAssertEqual(r.cert()["ok"] as? Bool, true)
        XCTAssertEqual(r.cert(logB)["error"] as? String, "cert-refused", "the bound request never changes")
        let bad = r.call(["op": "kernel.cert", "kernelKeyId": "gkey:v1:" + String(repeating: "0", count: 64), "pub": pem, "logId": logA])
        XCTAssertEqual(bad["error"] as? String, "bad-request")
    }

    func testFourPerBootHourPersisted() {
        let r = Rig11()
        for _ in 0..<4 { XCTAssertEqual(r.cert()["ok"] as? Bool, true) }
        XCTAssertEqual(r.cert()["error"] as? String, "rate-limited")
        // a new helper process (same items) is still limited in the same boot-hour
        let r2 = Rig11()
        r2.items.items = r.items.items
        r2.now = r.now
        XCTAssertEqual(r2.cert()["error"] as? String, "rate-limited")
        r2.boot = "BOOT-2"
        XCTAssertEqual(r2.cert()["ok"] as? Bool, true, "a new boot starts a new window")
        r.now = r.now.addingTimeInterval(3601)
        XCTAssertEqual(r.cert()["ok"] as? Bool, true, "an hour later")
    }

    func testAccessControlClassReadsAccc() throws {
        var err: Unmanaged<CFError>?
        let ac = try XCTUnwrap(SecAccessControlCreateWithFlags(kCFAllocatorDefault, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, [.privateKeyUsage], &err))
        XCTAssertEqual(accessControlClass([kSecAttrAccessControl as String: ac]), "cku")
        XCTAssertNil(accessControlClass([kSecAttrAccessible as String: "cku"]), "pdmn alone is never the check")
    }
}

final class AnchorTests: XCTestCase {
    let h1 = "sha256:" + String(repeating: "1", count: 64)
    let h2 = "sha256:" + String(repeating: "2", count: 64)

    func testWriteReadAndRollbackDetected() {
        let r = Rig11()
        XCTAssertEqual(r.call(["op": "anchor.read"])["empty"] as? Bool, true)
        XCTAssertEqual(r.call(["op": "anchor.write", "logId": logA, "seq": 10, "hash": h1])["written"] as? Bool, true)
        let back = r.call(["op": "anchor.read", "logId": logA, "seq": 9, "hash": h2])
        XCTAssertEqual(back["seq"] as? Int, 10)
        XCTAssertEqual(back["verdict"] as? String, "rollback", "a log behind the anchor is a rollback")
        XCTAssertEqual(r.call(["op": "anchor.read", "logId": logA, "seq": 10, "hash": h2])["verdict"] as? String, "fork")
        XCTAssertEqual(r.call(["op": "anchor.read", "logId": logA, "seq": 10, "hash": h1])["verdict"] as? String, "ok")
        XCTAssertEqual(r.call(["op": "anchor.read", "logId": logA, "seq": 12, "hash": h2])["verdict"] as? String, "ahead")
        r.now = r.now.addingTimeInterval(2)
        XCTAssertEqual(r.call(["op": "anchor.write", "logId": logA, "seq": 9, "hash": h2])["error"] as? String, "anchor-rollback")
        XCTAssertEqual(r.call(["op": "anchor.write", "logId": logA, "seq": 10, "hash": h2])["error"] as? String, "anchor-fork")
        XCTAssertEqual(r.call(["op": "anchor.write", "logId": logB, "seq": 1, "hash": h2])["error"] as? String, "anchor-log")
        XCTAssertEqual(r.call(["op": "anchor.write", "logId": logB, "seq": 1, "hash": h2, "newLog": true])["written"] as? Bool, true)
    }

    func testTenWritesASecondAndCallerChecked() {
        let r = Rig11()
        for i in 1...10 { XCTAssertEqual(r.call(["op": "anchor.write", "logId": logA, "seq": i, "hash": h1])["ok"] as? Bool, true) }
        XCTAssertEqual(r.call(["op": "anchor.write", "logId": logA, "seq": 11, "hash": h1])["error"] as? String, "rate-limited")
        r.now = r.now.addingTimeInterval(1)
        XCTAssertEqual(r.call(["op": "anchor.write", "logId": logA, "seq": 11, "hash": h1])["ok"] as? Bool, true)
        r.probe.f.tokenPid = 1
        XCTAssertEqual(r.call(["op": "anchor.read"])["error"] as? String, "caller-refused")
        XCTAssertEqual(r.call(["op": "anchor.write", "logId": logA, "seq": 12, "hash": h1])["error"] as? String, "caller-refused")
    }
}
