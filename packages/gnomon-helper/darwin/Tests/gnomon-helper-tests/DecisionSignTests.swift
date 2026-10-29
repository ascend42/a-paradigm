// gnomon-helper 1.8.0 unit tests (TD-2026-10-20-514, G-ID-09, G-ID-10; Aegis C1-C3, C7): `decision.sign` —
// exactly ONE presence evaluation per card decision, signing the approvals messages and every root row under it; the
// batch binding (v2 decision row, rowsDigest + intent, the per-cardKind row table) and the dialog line are refused or
// built before any prompt or key. No Secure Enclave: the presence and signer seams (Server.swift) stand in. The
// shared vectors (gnomon-contracts test/fixtures/decision-batch-vectors.json) are generated from the TS mirror, so
// every `shown` here is compared byte-exact with what the kernel rebuilds.

import Foundation
import LocalAuthentication
import XCTest
@testable import gnomon_helper

private func loadVectors() throws -> [Json] {
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().appendingPathComponent("gnomon-contracts/test/fixtures/decision-batch-vectors.json")
    let doc = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? Json)
    return try XCTUnwrap(doc["vectors"] as? [Json])
}

private func vector(_ name: String) throws -> Json {
    try XCTUnwrap(try loadVectors().first { ($0["name"] as? String) == name }, name)
}

/// Counts presence evaluations and records each signer call (key class, message count, the context used).
private final class Rig {
    var prompts: [String] = []
    var calls: [(KeyClass, Int, LAContext)] = []
    var contexts: [SpyContext] = []
    var deny = false
    var failRoot = false
    lazy var server = Server(
        presence: { [unowned self] reason in
            self.prompts.append(reason)
            if self.deny { throw HelperError("presence-denied", "cancelled") }
            let c = SpyContext()
            self.contexts.append(c)
            return c
        },
        signer: { [unowned self] k, _, ctx, msgs in
            self.calls.append((k, msgs.count, ctx))
            if k == .root && self.failRoot { throw HelperError("sign", "the root key did not sign") }
            return msgs.map { _ in "c2ln" }
        },
        session: FakeProbe(true))
}

private func request(_ v: Json) -> Json {
    var r: Json = ["op": "decision.sign", "gen": "test0001", "reason": "Gnomon: decide this card", "connId": "conn:01HZZZZZZZZZZZZZZZZZZZZZZA",
                   "approvals": (v["approvals"] as? [String] ?? []).map(b64), "root": (v["root"] as? [String] ?? []).map(b64)]
    if let i = v["intent"] as? String { r["intent"] = b64(i) }
    return r
}

private let allFive = "install: approve + presence, the decision row and all five grant rows"

final class DecisionSignTests: XCTestCase {
    func testOnePresenceSignsTheApprovalsAndEveryRootRow() throws {
        let v = try vector(allFive)
        let r = Rig()
        let out = try r.server.handle(request(v))
        XCTAssertEqual(r.prompts.count, 1, "exactly one presence evaluation per decision (G-ID-09)")
        XCTAssertEqual(r.calls.map { $0.0 }, [.approvals, .root])
        XCTAssertEqual(r.calls.map { $0.1 }, [2, 6])
        XCTAssertTrue(r.calls[0].2 === r.calls[1].2, "both keys sign under the ONE evaluated context")
        XCTAssertEqual((out["approvalSigs"] as? [String])?.count, 2)
        XCTAssertEqual((out["rootSigs"] as? [String])?.count, 6)
        XCTAssertEqual(out["kept"] as? Bool, false)
        XCTAssertTrue(r.contexts[0].invalidated, "the context is invalidated at once: no reuse window")
        XCTAssertEqual(r.server.custody.sync { r.server.custody.unlocks.count }, 0, "never Unlocks.put (C7)")
        // C2: the helper's line FIRST, byte-exact with the kernel's rebuild, then the capped kernel text
        let shown = try XCTUnwrap(out["shown"] as? String)
        XCTAssertEqual(shown, v["shown"] as? String)
        XCTAssertTrue(r.prompts[0].hasPrefix(shown + "\n"))
        XCTAssertTrue(shown.contains("egress api.example.com"))
        XCTAssertTrue(shown.contains("publisher acme → git.example.com/acme"))
    }

    func testRootOnlyFormAnchorsOnTheDecisionRow() throws {
        let r = Rig()
        let out = try r.server.handle(request(try vector("uninstall with no approvals messages at all")))
        XCTAssertEqual(r.prompts.count, 1)
        XCTAssertEqual(r.calls.map { $0.0 }, [.root])
        XCTAssertEqual((out["approvalSigs"] as? [String])?.count, 0)
    }

    func testDeclinedPromptSignsNothing() throws {
        let r = Rig()
        r.deny = true
        XCTAssertEqual(errorCode { try r.server.handle(request(try vector(allFive))) }, "presence-denied")
        XCTAssertEqual(r.prompts.count, 1)
        XCTAssertTrue(r.calls.isEmpty)
    }

    func testARootFailureFailsTheWholeDecisionAndInvalidates() throws {
        let r = Rig()
        r.failRoot = true
        XCTAssertEqual(errorCode { try r.server.handle(request(try vector(allFive))) }, "sign")
        XCTAssertTrue(r.contexts[0].invalidated)
    }

    func testKeepModeAndTheReasonCap() throws {
        let r = Rig()
        var q = request(try vector(allFive))
        q["keep"] = true
        XCTAssertEqual(errorCode { try r.server.handle(q) }, "bad-request")
        q = request(try vector(allFive))
        q["mode"] = "cached"
        XCTAssertEqual(errorCode { try r.server.handle(q) }, "bad-request")
        XCTAssertTrue(r.prompts.isEmpty)
        q = request(try vector(allFive))
        q["reason"] = String(repeating: "k", count: 400)
        _ = try r.server.handle(q)
        let tail = r.prompts[0].split(separator: "\n").last.map(String.init) ?? ""
        XCTAssertEqual(tail.count, Bounds.maxDecisionReasonChars, "the kernel's text is capped AFTER the helper's line")
    }

    func testBounds() throws {
        XCTAssertEqual(Bounds.maxDecisionMessages, 10)
        XCTAssertEqual(Bounds.maxMessages, 4, "plain sign keeps its bound")
        XCTAssertEqual(Bounds.maxDecisionBytes, 256 * 1024)
        let r = Rig()
        var q = request(try vector(allFive))
        q["intent"] = Data(count: Bounds.maxMessageBytes + 1).base64EncodedString()
        XCTAssertEqual(errorCode { try r.server.handle(q) }, "bad-request")
        XCTAssertTrue(r.prompts.isEmpty)
    }

    // ── 1.10.0 (TD-2026-10-28-969, C6'a2-h, G-HLP-02): the `permission` row table ──────────────────────────────

    /// A destructive brokered Always (cardKind `permission`, rootRows []) signs its decision row and nothing else.
    func testPermissionSignsOnlyItsDecisionRow() throws {
        XCTAssertNil(rowTableRefusal(cardKind: "permission", rows: []))
        let v = try vector("C3: a permission decision signs only its decision row")
        let r = Rig()
        let out = try r.server.handle(request(v))
        XCTAssertEqual(r.prompts.count, 1, "one presence for the decision")
        XCTAssertEqual(r.calls.map { $0.0 }, [.approvals, .root])
        XCTAssertEqual(r.calls.map { $0.1 }, [2, 1], "the root key signs the decision row only")
        XCTAssertEqual((out["rootSigs"] as? [String])?.count, 1)
        XCTAssertEqual(out["shown"] as? String, v["shown"] as? String)
        XCTAssertTrue((out["shown"] as? String ?? "").contains("always on permission"))
    }

    /// Any row after the decision row is refused before a prompt or a key, whatever its kind.
    func testPermissionRefusesAnyFurtherRow() throws {
        let why = "a permission decision signs only its decision row"
        let extras: [[Json]] = [
            [["schemaVersion": "grantRow:v1", "kind": "grant.trust", "cardId": "card:x"]],
            [["kind": "tool.rule", "cardId": "card:x"]],
            [["schemaVersion": "gnomon-root-local:v1", "cardId": "card:x"]],
            [["kind": "grant.install"], ["kind": "grant.install"]],
        ]
        for rows in extras { XCTAssertEqual(rowTableRefusal(cardKind: "permission", rows: rows), why) }
        let r = Rig()
        XCTAssertEqual(errorCode { try r.server.handle(request(try vector("C3: a permission decision never signs a grant row"))) }, "batch-refused")
        XCTAssertTrue(r.prompts.isEmpty, "a refused batch never prompts")
        XCTAssertTrue(r.calls.isEmpty, "a refused batch never signs")
    }

    /// The table stays closed: adding `permission` opens no other kind (nor a near-miss spelling of it).
    func testAnUnknownKindIsStillRefused() throws {
        for k in ["budget", "Permission", "permission.always", "permissions", "tool.rule", ""] {
            XCTAssertEqual(rowTableRefusal(cardKind: k, rows: []), "no row table for card kind \(k)", k)
        }
        let r = Rig()
        XCTAssertEqual(errorCode { try r.server.handle(request(try vector("C3: an unknown card kind"))) }, "batch-refused")
        XCTAssertTrue(r.prompts.isEmpty)
    }

    /// The ONE shared fixture, also read by packages/gnomon/test/decision-batch.test.ts (the TS mirror).
    func testSharedBindingVectors() throws {
        let vectors = try loadVectors()
        XCTAssertGreaterThanOrEqual(vectors.count, 40)
        for v in vectors {
            let name = v["name"] as? String ?? "?"
            let r = Rig()
            var out: Json = [:]
            let got = errorCode { out = try r.server.handle(request(v)); return out }
            XCTAssertEqual(got, v["error"] as? String, name)
            XCTAssertEqual(r.prompts.count, got == nil ? 1 : 0, "a refused batch never prompts: \(name)")
            if got == nil { XCTAssertEqual(out["shown"] as? String, v["shown"] as? String, "shown byte-exact: \(name)") }
        }
    }
}
