// gnomon-helper (darwin) 1.11.0 — `kernel.cert` (TD-2026-10-29-746, spec P8-D68, G-HLP-03).
//
// The kernel keeps its ephemeral Ed25519 key (a new one each start). This helper certifies it, at every boot and
// renewed while the kernel runs, with a Secure Enclave P-256 `kernel-cert` key:
//   - permanent, tag gnomon.kernel-cert, ONLY in the explicit group SW4BMQ8PNL.gnomon.prod (never the default
//     app-ID group); .privateKeyUsage, NO user presence, AfterFirstUnlockThisDeviceOnly. The class is checked from the
//     key's access control (accc), never pdmn (the S1 P3 finding: pdmn is not set from an access control);
//   - it signs `gnomon:kernel-cert:v1\n` + canonical JSON {schemaVersion: gnomon-kernel-cert:v1, kernelKeyId, pub, logId,
//     boot, pid, pidVersion, callerCdhash, startedAt, issuedAt, expiresAt}; pid, pidVersion and callerCdhash come from
//     the caller's audit token (Caller.swift), boot is kern.bootsessionuuid, startedAt the kernel process's start;
//   - only to the kernel instance that spawned this helper (CallerGate), for ONE kernel key per helper process;
//   - at most 4 per boot-hour (a window persisted in the helper's own item, so a helper restart does not reset it).
// A cert names its boot and logId: a verifier refuses it on another boot, for another log, or after expiresAt
// (kernelCertRefusal; the kernel's trust of it is slice S2).

import CryptoKit
import Foundation
import Security

let kernelCertSchema = "gnomon-kernel-cert:v1"
let kernelCertDomain = "gnomon:kernel-cert:v1\n"
let kernelCertTag = Data("gnomon.kernel-cert".utf8)
let kernelCertTtlSeconds: TimeInterval = 24 * 60 * 60
let kernelCertPerBootHour = 4
let kernelCertRateAccount = "gnomon-kernel-cert-rate"

/// The cert key seam (production: SecureEnclaveCertKey; tests: a CryptoKit software key).
protocol CertKey: AnyObject {
    /// X9.63 public key (65 bytes).
    func publicKey() throws -> Data
    /// DER ECDSA P-256 SHA-256 over the message.
    func sign(_ message: Data) throws -> Data
}

/// sha256:<hex> of the X9.63 public key: the id a row registers.
func certKeyId(_ pub: Data) -> String { sha256Tag(pub) }

/// The protection class of an item created with an access control: the first token of its accc description
/// (`<SecAccessControlRef: cku;…>`). P3: pdmn is not set from an access control, so it is never the check.
func accessControlClass(_ attrs: Json) -> String? {
    guard let ac = attrs[kSecAttrAccessControl as String] else { return nil }
    let d = CFCopyDescription(ac as CFTypeRef) as String
    guard let r = d.range(of: "SecAccessControlRef: ") else { return nil }
    return String(d[r.upperBound...].prefix { $0 != ";" && $0 != ">" })
}

final class SecureEnclaveCertKey: CertKey {
    private var cached: SecKey?
    private let lock = NSLock()

    private func query() -> Json {
        [kSecClass as String: kSecClassKey,
         kSecAttrApplicationTag as String: kernelCertTag,
         kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
         kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
         kSecAttrAccessGroup as String: accessGroup,
         kSecUseDataProtectionKeychain as String: true]
    }

    /// AfterFirstUnlockThisDeviceOnly read back from the stored item's access control; anything else is refused.
    private func checkProtection() throws {
        var q = query()
        q[kSecReturnAttributes as String] = true
        var item: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &item)
        guard st == errSecSuccess, let a = item as? Json else { throw HelperError("keychain", "the kernel-cert key does not read back", status: Int(st)) }
        guard accessControlClass(a) == "cku" else { throw HelperError("protection", "the kernel-cert key is not AfterFirstUnlockThisDeviceOnly") }
    }

    private func key() throws -> SecKey {
        lock.lock()
        defer { lock.unlock() }
        if let k = cached { return k }
        var q = query()
        q[kSecReturnRef as String] = true
        var item: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &item)
        if st == errSecSuccess, let k = item {
            try checkProtection()
            cached = (k as! SecKey) // swiftlint:disable:this force_cast
            return cached!
        }
        guard st == errSecItemNotFound else { throw HelperError("keychain", "kernel-cert key lookup failed", status: Int(st)) }
        var err: Unmanaged<CFError>?
        guard let ac = SecAccessControlCreateWithFlags(kCFAllocatorDefault, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, [.privateKeyUsage], &err) else { throw cfError(err, "access-control") }
        let attrs: Json = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecAttrAccessGroup as String: accessGroup,
            kSecUseDataProtectionKeychain as String: true,
            kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: kernelCertTag, kSecAttrAccessControl as String: ac] as Json,
        ]
        guard let k = SecKeyCreateRandomKey(attrs as CFDictionary, &err) else { throw cfError(err, "create") }
        do {
            try checkProtection()
        } catch {
            SecItemDelete(query() as CFDictionary)
            throw error
        }
        cached = k
        return k
    }

    func publicKey() throws -> Data {
        guard let pub = SecKeyCopyPublicKey(try key()) else { throw HelperError("keychain", "no public key") }
        var err: Unmanaged<CFError>?
        guard let raw = SecKeyCopyExternalRepresentation(pub, &err) as Data? else { throw cfError(err, "keychain") }
        return raw
    }

    func sign(_ message: Data) throws -> Data {
        var err: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(try key(), .ecdsaSignatureMessageX962SHA256, message as CFData, &err) as Data? else { throw cfError(err, "sign") }
        return sig
    }
}

struct CertRequest: Equatable {
    let kernelKeyId: String
    let pub: String
    let logId: String
}

/// The kernel's key id is gkey:v1:sha256(PEM without trailing newlines) (log/signer.ts ed25519KeyId); the helper checks it.
func certRequest(_ req: Json) throws -> CertRequest {
    guard let pub = req["pub"] as? String, pub.utf8.count <= 256, pub.hasPrefix("-----BEGIN PUBLIC KEY-----\n"), pub.hasSuffix("-----END PUBLIC KEY-----"),
          pub.unicodeScalars.allSatisfy({ $0.isASCII }) else { throw bad("pub is the kernel's Ed25519 public key PEM (no trailing newline)") }
    guard let kid = req["kernelKeyId"] as? String, kid == "gkey:v1:" + hex(Data(SHA256.hash(data: Data(pub.utf8)))) else { throw bad("kernelKeyId is gkey:v1:sha256 of pub") }
    guard let log = req["logId"] as? String, fullMatch(log, "^log:[0-9A-HJKMNP-TV-Z]{26}$") else { throw bad("logId is log:<ULID>") }
    return CertRequest(kernelKeyId: kid, pub: pub, logId: log)
}

func kernelCertRow(_ r: CertRequest, caller: Caller, boot: String, now: Date) -> Json {
    ["schemaVersion": kernelCertSchema, "kernelKeyId": r.kernelKeyId, "pub": r.pub, "logId": r.logId, "boot": boot,
     "pid": Int(caller.pid), "pidVersion": Int(caller.pidVersion), "callerCdhash": caller.cdhash,
     "startedAt": isoMs(caller.startedAt), "issuedAt": isoMs(now), "expiresAt": isoMs(now.addingTimeInterval(kernelCertTtlSeconds))]
}

func kernelCertMessage(_ row: Json) -> Data { Data(kernelCertDomain.utf8) + canonicalJSON(row) }

/// The verifier's rule (the kernel mirrors it in S2): a cert message is good only for THIS boot, THIS log and before
/// it expires, and only under the registered cert key. nil = good.
func kernelCertRefusal(message: Data, signature: Data, certKey: Data, boot: String, logId: String, now: Date) -> String? {
    guard let pk = try? P256.Signing.PublicKey(x963Representation: certKey), let sig = try? P256.Signing.ECDSASignature(derRepresentation: signature),
          pk.isValidSignature(sig, for: message) else { return "the cert is not signed by the kernel-cert key" }
    let d = Data(kernelCertDomain.utf8)
    guard message.starts(with: d), let row = (try? JSONSerialization.jsonObject(with: message.dropFirst(d.count))) as? Json,
          row["schemaVersion"] as? String == kernelCertSchema else { return "not a gnomon-kernel-cert:v1 message" }
    guard row["boot"] as? String == boot else { return "the cert is from another boot" }
    guard row["logId"] as? String == logId else { return "the cert names another log" }
    guard let exp = (row["expiresAt"] as? String).flatMap(parseIso), let iss = (row["issuedAt"] as? String).flatMap(parseIso),
          iss <= now.addingTimeInterval(300), now < exp else { return "the cert is expired or not yet valid" }
    return nil
}

/// Issues certs for one helper process: one kernel key, the persisted per-boot-hour window.
final class CertIssuer {
    let key: CertKey
    let items: ItemStore
    let boot: () -> String
    let clock: () -> Date
    private var bound: CertRequest?
    private let lock = NSLock()

    init(key: CertKey, items: ItemStore, boot: @escaping () -> String = bootSessionId, clock: @escaping () -> Date = Date.init) {
        self.key = key
        self.items = items
        self.boot = boot
        self.clock = clock
    }

    private func takeRate(_ b: String, _ now: Date) throws {
        var stamps: [Date] = []
        if let d = try items.read(kernelCertRateAccount), let o = (try? JSONSerialization.jsonObject(with: d)) as? Json, o["boot"] as? String == b {
            stamps = ((o["issued"] as? [Double]) ?? []).map { Date(timeIntervalSince1970: $0) }
        }
        var w = RateWindow(limit: kernelCertPerBootHour, seconds: 3600, stamps: stamps)
        guard w.take(now) else { throw HelperError("rate-limited", "at most \(kernelCertPerBootHour) kernel certs per boot-hour") }
        try items.write(kernelCertRateAccount, canonicalJSON(["boot": b, "issued": w.stamps.map { $0.timeIntervalSince1970 }] as Json))
    }

    /// 1.11.1 (Aegis S2 M-2): the Ed25519 public key PEM this helper certified (nil before the first cert). A genesis
    /// row moves the anchor only when this key signed it (Anchor.swift genesisSigRefusal).
    var certifiedPub: String? {
        lock.lock()
        defer { lock.unlock() }
        return bound?.pub
    }

    func issue(_ r: CertRequest, caller: Caller) throws -> Json {
        lock.lock()
        defer { lock.unlock() }
        if let b = bound, b != r { throw HelperError("cert-refused", "this helper certifies one kernel key; it was started for another") }
        let b = boot()
        guard !b.isEmpty else { throw HelperError("cert-refused", "the boot session is unknown") }
        let now = clock()
        try takeRate(b, now)
        let row = kernelCertRow(r, caller: caller, boot: b, now: now)
        let msg = kernelCertMessage(row)
        let sig = try key.sign(msg)
        let pub = try key.publicKey()
        bound = r
        return ["cert": msg.base64EncodedString(), "sig": sig.base64EncodedString(), "certKey": pub.base64EncodedString(), "certKeyId": certKeyId(pub),
                "expiresAt": row["expiresAt"]!, "boot": b]
    }
}
