// gnomon-helper (darwin) 1.11.0 — the CLICK KEY, helper side (TD-2026-10-29-894/-746, G-HLP-04). While the global
// Touch ID switch is OFF, a card approval is a click: the kernel asks this helper to sign `gnomon:approve:v1` with a
// click key bound to the app-bound GUI connection, and rows carry the click keyId (the "click-made" mark).
//
//   click.open {connId, appBound: true, modeRowHash}
//     only for the signed kernel (Caller.swift); only when the helper's OWN stored mode is off (Mode.swift) and the
//     kernel presents that mode row's hash; only while the session is usable. Fail closed: an unreadable or
//     mismatched mode issues nothing. Creates a NON-permanent Secure Enclave P-256 key (never in the keychain); the
//     key object lives only in this process. Its attributes and token blob are never read, written, logged or sent
//     (the source guard in ClickKeyTests fails the build otherwise; S0 P2: a token blob reloads in another process).
//   click.sign {connId, keyId, cardKind, messages[]}
//     `gnomon:approve:v1` ONLY: never presence:v1, approve-voice:v1 or row-sig:v1, and never for a root card kind
//     (clickRootKinds). At most 60 a minute (all keys) and 512 per key.
//   Revoked on conn.close of its connId, on every session event (lock, screensaver, display or system sleep, user
//   switch: Custody.invalidateAll, before the push), after 12 h (Bounds.unlockAbsoluteSeconds), when the mode goes
//   back on, and when this process exits.

import Foundation
import Security

/// The card kinds whose decisions are root actions (TD-2026-10-29-894): a click never signs for them. `permission`
/// is not here: an ordinary permission card is a click when Touch ID is off, and its destructive Always is a root
/// row that only decision.sign (one presence) can sign.
let clickRootKinds: Set<String> = ["install", "uninstall", "voice.enrol", "mod.mcp.config", "api-token", "peer-pair", "grant", "loop-trust",
                                   "local.config", "presence.mode", "kernel-custody", "repin", "root-grant"]
let maxClickKeys = 8
let clickPerMinute = 60

protocol ClickSigner: AnyObject {
    /// X9.63 public key.
    var publicKey: Data { get }
    func sign(_ message: Data) throws -> Data
}

/// The production click key: a non-permanent Secure Enclave P-256 key, no presence.
final class EphemeralSEClickKey: ClickSigner {
    private let key: SecKey
    let publicKey: Data

    init() throws {
        var err: Unmanaged<CFError>?
        guard let ac = SecAccessControlCreateWithFlags(kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage], &err) else { throw cfError(err, "access-control") }
        let attrs: Json = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: false, kSecAttrAccessControl as String: ac] as Json,
        ]
        guard let k = SecKeyCreateRandomKey(attrs as CFDictionary, &err) else { throw cfError(err, "create") }
        guard let pub = SecKeyCopyPublicKey(k), let raw = SecKeyCopyExternalRepresentation(pub, &err) as Data? else { throw cfError(err, "create") }
        key = k
        publicKey = raw
    }

    func sign(_ message: Data) throws -> Data {
        var err: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, message as CFData, &err) as Data? else { throw cfError(err, "sign") }
        return sig
    }
}

/// The click keys held (one per connId). Not thread-safe on its own: every access goes through Custody.sync.
final class ClickKeys {
    private struct Entry {
        let signer: ClickSigner
        let keyId: String
        let opened: Date
        var signatures: Int
    }

    private var byConn: [String: Entry] = [:]
    private var window = RateWindow(limit: clickPerMinute, seconds: 60)
    let now: () -> Date

    init(now: @escaping () -> Date = Date.init) { self.now = now }

    var count: Int {
        sweep()
        return byConn.count
    }

    func keyId(_ connId: String) -> String? {
        sweep()
        return byConn[connId]?.keyId
    }

    /// nil = refused (full). A re-open for the same connId replaces (revokes) its old key.
    func put(_ connId: String, _ signer: ClickSigner) -> String? {
        sweep()
        byConn.removeValue(forKey: connId)
        guard byConn.count < maxClickKeys else { return nil }
        let id = "click:" + sha256Tag(signer.publicKey).dropFirst(7).prefix(32)
        byConn[connId] = Entry(signer: signer, keyId: id, opened: now(), signatures: 0)
        return id
    }

    enum Use { case ok(ClickSigner), noKey, rate }

    func use(_ connId: String, keyId: String, signatures n: Int) -> Use {
        sweep()
        guard var e = byConn[connId], e.keyId == keyId else { return .noKey }
        guard n > 0, e.signatures + n <= Bounds.maxSignaturesPerUnlock else {
            byConn.removeValue(forKey: connId)
            return .noKey
        }
        let t = now()
        var w = window
        for _ in 0..<n { guard w.take(t) else { return .rate } }
        window = w
        e.signatures += n
        byConn[connId] = e
        return .ok(e.signer)
    }

    @discardableResult
    func drop(_ connId: String) -> Bool { byConn.removeValue(forKey: connId) != nil }

    @discardableResult
    func dropAll() -> Int {
        let n = byConn.count
        byConn.removeAll() // releasing the last reference destroys a non-permanent SE key
        return n
    }

    private func sweep() {
        let t = now()
        for (k, e) in byConn where t.timeIntervalSince(e.opened) >= Bounds.unlockAbsoluteSeconds || t < e.opened.addingTimeInterval(-300) {
            byConn.removeValue(forKey: k)
        }
    }
}

/// click.sign's domain rule, checked before any key is touched: approve:v1 decision preimages only.
func clickMessages(_ req: Json) throws -> [Data] {
    guard let kind = req["cardKind"] as? String, !kind.isEmpty, kind.count <= 64 else { throw bad("click.sign names the card kind") }
    guard !clickRootKinds.contains(kind) else { throw HelperError("domain-refused", "a root card is never approved by a click") }
    guard let arr = req["messages"] as? [Any], !arr.isEmpty, arr.count <= Bounds.maxMessages else { throw bad("messages must be 1..\(Bounds.maxMessages) base64 strings") }
    return try arr.map { item in
        guard let s = item as? String, let d = Data(base64Encoded: s), !d.isEmpty, d.count <= Bounds.maxMessageBytes else { throw bad("each message must be base64 of 1..\(Bounds.maxMessageBytes) bytes") }
        guard d.starts(with: Data(approveDomain.utf8)), parseApprove(d) != nil else { throw HelperError("domain-refused", "a click key signs only gnomon:approve:v1 decisions") }
        return d
    }
}
