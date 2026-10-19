// gnomon-helper (darwin) — Secure Enclave keys behind presence (spec §3.1;
// recipe proven by probe P04: bundle id gnomon.helper, team SW4BMQ8PNL,
// access group SW4BMQ8PNL.gnomon, embedded Developer ID provisioning
// profile, hardened runtime). Production keys live in their OWN access group
// SW4BMQ8PNL.gnomon.prod (Aegis H1): the probe helper (identifier
// gnomon.probe) is signed into SW4BMQ8PNL.gnomon.probe and never lists this one.
//
//   root       SE P-256, .privateKeyUsage + .userPresence; FRESH presence per
//              signature (a new LAContext, evaluated, then invalidated).
//   approvals  SE P-256, .privateKeyUsage + .userPresence; fresh presence, or
//              a per-connection CACHED unlock: the evaluated LAContext is held
//              here keyed by the kernel's connId (the kernel holds only the
//              reference, S29-K5), with interactionNotAllowed set so a cached
//              sign can never raise a prompt; dropped after 15 idle minutes,
//              60 minutes after it opened, after 64 signatures (T-2026-10-18-028
//              M2: hard bounds the idle timer cannot slide), on unlock.drop, and
//              when this process exits; helper 1.6.0 also on conn.close, on any
//              session event (lock, screensaver, display or system sleep, user
//              switch: SessionWatch.swift) and never for the voice domain.
//              Voice ARMS are a separate store (Custody.swift).

import Foundation
import LocalAuthentication
import Security

let accessGroup = "SW4BMQ8PNL.gnomon.prod"

func tag(_ key: KeyClass, _ gen: String) -> Data { Data("gnomon.\(gen).\(key.rawValue)".utf8) }

func keyQuery(_ key: KeyClass, _ gen: String) -> Json {
    [kSecClass as String: kSecClassKey,
     kSecAttrApplicationTag as String: tag(key, gen),
     kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
     kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
     kSecAttrAccessGroup as String: accessGroup,
     kSecUseDataProtectionKeychain as String: true]
}

func cfError(_ e: Unmanaged<CFError>?, _ code: String) -> HelperError {
    guard let err = e?.takeRetainedValue() else { return HelperError(code, "unknown error") }
    return HelperError(code, CFErrorCopyDescription(err) as String, status: CFErrorGetCode(err))
}

func loadPrivateKey(_ key: KeyClass, _ gen: String, context: LAContext?) throws -> SecKey {
    var q = keyQuery(key, gen)
    q[kSecReturnRef as String] = true
    if let c = context { q[kSecUseAuthenticationContext as String] = c }
    var item: CFTypeRef?
    let st = SecItemCopyMatching(q as CFDictionary, &item)
    if st == errSecItemNotFound { throw HelperError("not-found", "no \(key.rawValue) key for this generation", status: Int(st)) }
    guard st == errSecSuccess, let found = item else { throw HelperError("keychain", "key lookup failed", status: Int(st)) }
    return found as! SecKey // swiftlint:disable:this force_cast — kSecReturnRef on kSecClassKey yields a SecKey
}

/// The public key as X9.63 (0x04 ‖ X ‖ Y, 65 bytes), base64.
func publicKeyB64(_ priv: SecKey) throws -> String {
    guard let pub = SecKeyCopyPublicKey(priv) else { throw HelperError("keychain", "no public key") }
    var err: Unmanaged<CFError>?
    guard let raw = SecKeyCopyExternalRepresentation(pub, &err) as Data? else { throw cfError(err, "keychain") }
    return raw.base64EncodedString()
}

func createKey(_ key: KeyClass, _ gen: String) throws -> String {
    if (try? loadPrivateKey(key, gen, context: nil)) != nil { throw HelperError("exists", "a \(key.rawValue) key already exists for this generation") }
    var err: Unmanaged<CFError>?
    guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], &err) else {
        throw cfError(err, "access-control")
    }
    let attrs: Json = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecAttrAccessGroup as String: accessGroup,
        kSecUseDataProtectionKeychain as String: true,
        kSecPrivateKeyAttrs as String: [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: tag(key, gen),
            kSecAttrAccessControl as String: ac,
        ] as Json,
    ]
    guard let priv = SecKeyCreateRandomKey(attrs as CFDictionary, &err) else { throw cfError(err, "create") }
    return try publicKeyB64(priv)
}

/// Every production key in the access group: (gen, key) parsed from tags `gnomon.<gen>.<root|approvals>`.
func listKeys() -> [(gen: String, key: KeyClass)] {
    let q: Json = [kSecClass as String: kSecClassKey,
                   kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                   kSecAttrAccessGroup as String: accessGroup,
                   kSecUseDataProtectionKeychain as String: true,
                   kSecReturnAttributes as String: true,
                   kSecMatchLimit as String: kSecMatchLimitAll]
    var items: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &items) == errSecSuccess, let arr = items as? [Json] else { return [] }
    var out: [(gen: String, key: KeyClass)] = []
    for a in arr {
        guard let t = a[kSecAttrApplicationTag as String] as? Data else { continue }
        let parts = String(decoding: t, as: UTF8.self).split(separator: ".")
        guard parts.count == 3, parts[0] == "gnomon", let k = KeyClass(rawValue: String(parts[2])) else { continue }
        out.append((gen: String(parts[1]), key: k))
    }
    return out
}

/// Verify a DER ECDSA signature by the PUBLIC half of (key, gen) — no presence needed.
func verifyBy(_ key: KeyClass, _ gen: String, message: Data, signature: Data) -> Bool {
    guard let priv = try? loadPrivateKey(key, gen, context: nil), let pub = SecKeyCopyPublicKey(priv) else { return false }
    var err: Unmanaged<CFError>?
    return SecKeyVerifySignature(pub, .ecdsaSignatureMessageX962SHA256, message as CFData, signature as CFData, &err)
}

func deleteKey(_ key: KeyClass, _ gen: String) -> Bool {
    let st = SecItemDelete(keyQuery(key, gen) as CFDictionary)
    return st == errSecSuccess
}

/// Evaluate presence (Touch ID, or the login password as fallback) with the kernel's prompt text.
func evaluatePresence(_ reason: String) throws -> LAContext {
    let ctx = LAContext()
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    var failure: Error?
    ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, e in
        ok = success
        failure = e
        sem.signal()
    }
    sem.wait()
    guard ok else {
        let code = (failure as NSError?)?.code ?? 0
        // LAError.userCancel / appCancel / systemCancel / userFallback-cancel ⇒ denied; everything else ⇒ unavailable
        let denied = [LAError.userCancel.rawValue, LAError.appCancel.rawValue, LAError.systemCancel.rawValue, LAError.authenticationFailed.rawValue].contains(code)
        throw HelperError(denied ? "presence-denied" : "presence-unavailable", failure.map { "\($0.localizedDescription)" } ?? "presence not proved", status: code)
    }
    ctx.interactionNotAllowed = true // any further prompt on this context fails instead of showing
    return ctx
}

func signAll(_ priv: SecKey, _ msgs: [Data]) throws -> [String] {
    try msgs.map { m in
        var err: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(priv, .ecdsaSignatureMessageX962SHA256, m as CFData, &err) as Data? else { throw cfError(err, "sign") }
        return sig.base64EncodedString() // DER (X9.62); the kernel converts to IEEE-P1363 and verifies against the pinned key
    }
}

/// Per-connection approvals unlocks (bounded; idle-expiring). Not thread-safe on its own: every access goes
/// through Custody.sync (Custody.swift).
final class Unlocks {
    private struct Entry {
        let gen: String
        let ctx: LAContext
        let opened: Date
        var lastUsed: Date
        var signatures: Int
    }

    private var byConn: [String: Entry] = [:]

    var count: Int { byConn.count }

    func put(_ connId: String, gen: String, ctx: LAContext) -> Bool {
        sweep()
        if byConn[connId] == nil && byConn.count >= Bounds.maxUnlocks { return false }
        byConn[connId]?.ctx.invalidate()
        let now = Date()
        byConn[connId] = Entry(gen: gen, ctx: ctx, opened: now, lastUsed: now, signatures: 0)
        return true
    }

    /// Spend `signatures` of THIS connection's unlock. nil = none, another generation, or the
    /// unlock has hit its absolute TTL or signature cap (then it is invalidated and dropped).
    func use(_ connId: String, gen: String, signatures n: Int) -> LAContext? {
        sweep()
        guard var e = byConn[connId], e.gen == gen else { return nil }
        guard n > 0, e.signatures + n <= Bounds.maxSignaturesPerUnlock else {
            drop(connId)
            return nil
        }
        e.lastUsed = Date()
        e.signatures += n
        byConn[connId] = e
        return e.ctx
    }

    @discardableResult
    func drop(_ connId: String) -> Bool {
        guard let e = byConn.removeValue(forKey: connId) else { return false }
        e.ctx.invalidate()
        return true
    }

    func dropAll() -> Int {
        let n = byConn.count
        for e in byConn.values { e.ctx.invalidate() }
        byConn.removeAll()
        return n
    }

    private func sweep() {
        let now = Date()
        for (k, e) in byConn where now.timeIntervalSince(e.lastUsed) > Bounds.unlockIdleSeconds
            || now.timeIntervalSince(e.opened) > Bounds.unlockAbsoluteSeconds
            || e.signatures >= Bounds.maxSignaturesPerUnlock {
            e.ctx.invalidate()
            byConn.removeValue(forKey: k)
        }
    }
}
