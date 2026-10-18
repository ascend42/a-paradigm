// gnomon-helper (darwin) — Secure Enclave keys behind presence (spec §3.1;
// recipe proven by probe P04: bundle id gnomon.helper, team SW4BMQ8PNL,
// access group SW4BMQ8PNL.gnomon, embedded Developer ID provisioning
// profile, hardened runtime).
//
//   root       SE P-256, .privateKeyUsage + .userPresence; FRESH presence per
//              signature (a new LAContext, evaluated, then invalidated).
//   approvals  SE P-256, .privateKeyUsage + .userPresence; fresh presence, or
//              a per-connection CACHED unlock: the evaluated LAContext is held
//              here keyed by the kernel's connId (the kernel holds only the
//              reference, S29-K5), with interactionNotAllowed set so a cached
//              sign can never raise a prompt; dropped after 15 idle minutes,
//              on unlock.drop, and when this process exits.

import Foundation
import LocalAuthentication
import Security

let accessGroup = "SW4BMQ8PNL.gnomon"

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

/// Per-connection approvals unlocks (bounded; idle-expiring).
final class Unlocks {
    private struct Entry {
        let gen: String
        let ctx: LAContext
        var lastUsed: Date
    }

    private var byConn: [String: Entry] = [:]

    var count: Int { byConn.count }

    func put(_ connId: String, gen: String, ctx: LAContext) -> Bool {
        sweep()
        if byConn[connId] == nil && byConn.count >= Bounds.maxUnlocks { return false }
        byConn[connId]?.ctx.invalidate()
        byConn[connId] = Entry(gen: gen, ctx: ctx, lastUsed: Date())
        return true
    }

    func use(_ connId: String, gen: String) -> LAContext? {
        sweep()
        guard var e = byConn[connId], e.gen == gen else { return nil }
        e.lastUsed = Date()
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
        for (k, e) in byConn where now.timeIntervalSince(e.lastUsed) > Bounds.unlockIdleSeconds {
            e.ctx.invalidate()
            byConn.removeValue(forKey: k)
        }
    }
}
