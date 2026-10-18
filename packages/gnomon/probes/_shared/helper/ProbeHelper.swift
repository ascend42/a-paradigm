// Gnomon probe helper stub — P00 (signed stub), P04 / S29-01 (Secure Enclave),
// P05 / S29-02 (keychain ACL + integrity). NOT the product helper
// (packages/gnomon-helper): a throwaway with the same identity shape —
// bundle id gnomon.helper, team SW4BMQ8PNL, access group SW4BMQ8PNL.gnomon —
// built by _shared/signing.mjs into a .app with the Developer ID provisioning
// profile embedded, hardened runtime, Developer ID signature.
//
// Every command prints ONE JSON line and never prints key material or item
// data (only lengths and sha256 prefixes). Every command refuses to run
// sandboxed (P8-D68): {"ok":false,"error":"SANDBOXED"}, exit 3.
//
//   info
//   se-create <tag> [presence|custody]   SE P-256 in the access group
//   se-sign <tag> <n> <reason>           one evaluated LAContext signs n times
//                                        (interactionNotAllowed after the touch),
//                                        then invalidate() and a fresh context
//   se-delete <tag>
//   kc-create <service> <account> <custodyTag> [dp]   32 random bytes; comment =
//                                        custody-key signature over the data
//   kc-read <service> <account> [dp]
//   kc-integrity <service> <account> <custodyTag> [dp]  OK | INTEGRITY_BROKEN
//   kc-delete <service> <account> [dp]
import CryptoKit
import Foundation
import LocalAuthentication
import Security

let accessGroup = "SW4BMQ8PNL.gnomon"

func emit(_ d: [String: Any], code: Int32? = nil) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(code ?? ((d["ok"] as? Bool) == true ? 0 : 1))
}

func cfErr(_ e: Unmanaged<CFError>?) -> [String: Any] {
    guard let e = e?.takeRetainedValue() else { return ["error": "unknown"] }
    return ["code": CFErrorGetCode(e), "domain": CFErrorGetDomain(e) as String, "error": CFErrorCopyDescription(e) as String]
}

func hexPrefix(_ d: Data) -> String {
    SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined().prefix(16).description
}

typealias SandboxCheck = @convention(c) (pid_t, UnsafePointer<CChar>?, Int32) -> Int32
func isSandboxed() -> Bool {
    guard let h = dlopen(nil, RTLD_NOW), let s = dlsym(h, "sandbox_check") else { return false }
    return unsafeBitCast(s, to: SandboxCheck.self)(getpid(), nil, 0) != 0
}

func signingInfo() -> [String: Any] {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let c = code else { return ["error": "SecCodeCopySelf"] }
    var st: SecStaticCode?
    SecCodeCopyStaticCode(c, [], &st)
    var info: CFDictionary?
    guard let s = st, SecCodeCopySigningInformation(s, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let d = info as? [String: Any] else { return ["error": "SecCodeCopySigningInformation"] }
    var out: [String: Any] = ["identifier": d[kSecCodeInfoIdentifier as String] as? String ?? NSNull()]
    out["team"] = d[kSecCodeInfoTeamIdentifier as String] as? String ?? NSNull()
    if let ent = d[kSecCodeInfoEntitlementsDict as String] as? [String: Any] { out["entitlements"] = Array(ent.keys).sorted() }
    return out
}

func keyQuery(_ tag: String) -> [String: Any] {
    [kSecClass as String: kSecClassKey,
     kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
     kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
     kSecAttrAccessGroup as String: accessGroup,
     kSecUseDataProtectionKeychain as String: true]
}

func loadKey(_ tag: String, context: LAContext?) -> (SecKey?, OSStatus) {
    var q = keyQuery(tag)
    q[kSecReturnRef as String] = true
    if let c = context { q[kSecUseAuthenticationContext as String] = c }
    var item: CFTypeRef?
    let st = SecItemCopyMatching(q as CFDictionary, &item)
    return (st == errSecSuccess ? (item as! SecKey) : nil, st)
}

func sign(_ key: SecKey, _ data: Data) -> (Bool, [String: Any]?) {
    var err: Unmanaged<CFError>?
    if SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, data as CFData, &err) != nil { return (true, nil) }
    return (false, cfErr(err))
}

func itemQuery(_ service: String, _ account: String, dp: Bool) -> [String: Any] {
    var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                            kSecAttrService as String: service,
                            kSecAttrAccount as String: account,
                            kSecUseDataProtectionKeychain as String: dp]
    if dp { q[kSecAttrAccessGroup as String] = accessGroup }
    return q
}

let args = Array(CommandLine.arguments.dropFirst())
if isSandboxed() { emit(["ok": false, "error": "SANDBOXED", "note": "the helper refuses to run sandboxed (P8-D68)"], code: 3) }
guard let cmd = args.first else { emit(["ok": false, "error": "usage"], code: 64) }

switch cmd {
case "info":
    emit(["ok": true, "pid": getpid(), "sandboxed": false, "signing": signingInfo(), "bundleId": Bundle.main.bundleIdentifier ?? NSNull()])

case "se-create":
    guard args.count >= 2 else { emit(["ok": false, "error": "usage"], code: 64) }
    let presence = args.count < 3 || args[2] == "presence"
    var err: Unmanaged<CFError>?
    let flags: SecAccessControlCreateFlags = presence ? [.privateKeyUsage, .userPresence] : [.privateKeyUsage]
    guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, &err) else {
        emit(["ok": false, "stage": "access-control"].merging(cfErr(err)) { a, _ in a })
    }
    let attrs: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecAttrAccessGroup as String: accessGroup,
        kSecUseDataProtectionKeychain as String: true,
        kSecPrivateKeyAttrs as String: [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: args[1].data(using: .utf8)!,
            kSecAttrAccessControl as String: ac,
        ] as [String: Any],
    ]
    guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, &err) else {
        emit(["ok": false, "stage": "create", "presence": presence].merging(cfErr(err)) { a, _ in a })
    }
    let pub = SecKeyCopyExternalRepresentation(SecKeyCopyPublicKey(key)!, nil)! as Data
    emit(["ok": true, "tag": args[1], "presence": presence, "publicKeySha256": hexPrefix(pub), "publicKeyBytes": pub.count])

case "se-sign":
    guard args.count >= 4, let n = Int(args[2]) else { emit(["ok": false, "error": "usage"], code: 64) }
    let reason = args[3]
    let ctx = LAContext()
    let sem = DispatchSemaphore(value: 0)
    var evalOk = false
    var evalErr: String?
    let t0 = Date()
    ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, e in
        evalOk = ok
        evalErr = e.map { "\($0)" }
        sem.signal()
    }
    sem.wait()
    var out: [String: Any] = ["reasonChars": reason.count, "evaluate": ["ok": evalOk, "error": evalErr ?? NSNull(), "ms": Int(Date().timeIntervalSince(t0) * 1000)] as [String: Any]]
    guard evalOk else { emit(out.merging(["ok": false]) { a, _ in a }) }
    ctx.interactionNotAllowed = true // any further prompt now fails instead of showing
    let (key, st) = loadKey(args[1], context: ctx)
    guard let k = key else { emit(out.merging(["ok": false, "stage": "load", "status": Int(st)]) { a, _ in a }) }
    var okCount = 0
    var firstErr: [String: Any]?
    for i in 0..<n {
        let (ok, e) = sign(k, "gnomon-p04-\(i)".data(using: .utf8)!)
        if ok { okCount += 1 } else if firstErr == nil { firstErr = e }
    }
    out["reuse"] = ["requested": n, "signedWithoutPrompt": okCount, "firstError": firstErr ?? NSNull()] as [String: Any]
    ctx.invalidate()
    let (ok2, e2) = sign(k, "after-invalidate".data(using: .utf8)!)
    out["afterInvalidate"] = ["signed": ok2, "error": e2 ?? NSNull()] as [String: Any]
    let fresh = LAContext()
    fresh.localizedReason = reason
    let (k3, st3) = loadKey(args[1], context: fresh)
    if let k3 = k3 {
        let t1 = Date()
        let (ok3, e3) = sign(k3, "fresh-context".data(using: .utf8)!)
        out["freshContext"] = ["signed": ok3, "error": e3 ?? NSNull(), "ms": Int(Date().timeIntervalSince(t1) * 1000)] as [String: Any]
    } else {
        out["freshContext"] = ["signed": false, "status": Int(st3)]
    }
    emit(out.merging(["ok": true]) { a, _ in a })

case "se-delete":
    guard args.count >= 2 else { emit(["ok": false, "error": "usage"], code: 64) }
    let st = SecItemDelete(keyQuery(args[1]) as CFDictionary)
    emit(["ok": st == errSecSuccess || st == errSecItemNotFound, "status": Int(st)])

case "kc-create":
    guard args.count >= 4 else { emit(["ok": false, "error": "usage"], code: 64) }
    let dp = args.count >= 5 && args[4] == "dp"
    var bytes = Data(count: 32)
    _ = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
    let (ck, cst) = loadKey(args[3], context: nil)
    guard let custody = ck else { emit(["ok": false, "stage": "custody-key", "status": Int(cst)]) }
    var err: Unmanaged<CFError>?
    guard let sig = SecKeyCreateSignature(custody, .ecdsaSignatureMessageX962SHA256, bytes as CFData, &err) as Data? else {
        emit(["ok": false, "stage": "custody-sign"].merging(cfErr(err)) { a, _ in a })
    }
    var q = itemQuery(args[1], args[2], dp: dp)
    q[kSecValueData as String] = bytes
    q[kSecAttrComment as String] = sig.base64EncodedString()
    q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let st = SecItemAdd(q as CFDictionary, nil)
    emit(["ok": st == errSecSuccess, "status": Int(st), "dataProtection": dp, "dataSha256": hexPrefix(bytes)])

case "kc-read", "kc-integrity":
    let need = cmd == "kc-read" ? 3 : 4
    guard args.count >= need else { emit(["ok": false, "error": "usage"], code: 64) }
    let dp = args.count > need && args[need] == "dp"
    var q = itemQuery(args[1], args[2], dp: dp)
    q[kSecReturnData as String] = true
    q[kSecReturnAttributes as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let t0 = Date()
    let st = SecItemCopyMatching(q as CFDictionary, &item)
    let ms = Int(Date().timeIntervalSince(t0) * 1000)
    guard st == errSecSuccess, let d = item as? [String: Any], let data = d[kSecValueData as String] as? Data else {
        emit(["ok": false, "status": Int(st), "dataProtection": dp, "ms": ms])
    }
    if cmd == "kc-read" { emit(["ok": true, "bytes": data.count, "dataSha256": hexPrefix(data), "dataProtection": dp, "ms": ms]) }
    let (ck, cst) = loadKey(args[3], context: nil)
    guard let custody = ck, let pub = SecKeyCopyPublicKey(custody) else { emit(["ok": false, "stage": "custody-key", "status": Int(cst)]) }
    let sig = (d[kSecAttrComment as String] as? String).flatMap { Data(base64Encoded: $0) } ?? Data()
    var err: Unmanaged<CFError>?
    let valid = !sig.isEmpty && SecKeyVerifySignature(pub, .ecdsaSignatureMessageX962SHA256, data as CFData, sig as CFData, &err)
    emit(["ok": valid, "integrity": valid ? "OK" : "INTEGRITY_BROKEN", "dataProtection": dp, "ms": ms])

case "kc-delete":
    guard args.count >= 3 else { emit(["ok": false, "error": "usage"], code: 64) }
    let dp = args.count >= 4 && args[3] == "dp"
    let st = SecItemDelete(itemQuery(args[1], args[2], dp: dp) as CFDictionary)
    emit(["ok": st == errSecSuccess || st == errSecItemNotFound, "status": Int(st)])

default:
    emit(["ok": false, "error": "unknown command \(cmd)"], code: 64)
}
