// Gnomon S0 probe tool (TD-2026-10-29-746 slice S0): p15-sea-peertoken (P1), p16-se-ephemeral (P2),
// p17-se-afterfirstunlock (P3). NOT the product helper: it is never signed gnomon.helper and only touches the
// probe access group SW4BMQ8PNL.gnomon.probe (Aegis H1). Built by _shared/kernel-probe.mjs.
//
// Every command prints ONE JSON line; never key material (lengths and sha256 prefixes only).
//
//   peer-check <requirement>       fd 0 must be the socket a parent handed us as stdin. Reads the peer's audit token
//                                  (getsockopt SOL_LOCAL LOCAL_PEERTOKEN), makes a SecCode from it
//                                  (kSecGuestAttributeAudit) and runs SecCodeCheckValidity against <requirement>.
//   se-ephemeral [<blobOut>]       a NON-permanent Secure Enclave P-256 key (kSecAttrIsPermanent false,
//                                  .privateKeyUsage only, AfterFirstUnlockThisDeviceOnly): create, sign, verify, look it
//                                  up in the keychain (expect none), list its attribute keys; with <blobOut> write its
//                                  token object blob ("toid", if any) base64 to that file (0600) for se-reimport.
//   se-lookup <label>              a second process: is any key with this label in the keychain?
//   se-reimport <blobFile>         a second process: can the token blob be loaded and used (CryptoKit)?
//   se-perm-create <tag> <group>   a PERMANENT SE key in <group> (AfterFirstUnlockThisDeviceOnly, .privateKeyUsage)
//   se-perm-sign <tag> <group>     load it and sign (no presence)
//   se-perm-delete <tag> <group>
import CryptoKit
import Foundation
import Security

let probeGroup = "SW4BMQ8PNL.gnomon.probe"

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

func signingInfo(_ code: SecCode) -> [String: Any] {
    var st: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &st) == errSecSuccess, let s = st else { return ["error": "SecCodeCopyStaticCode"] }
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(s, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess, let d = info as? [String: Any] else { return ["error": "SecCodeCopySigningInformation"] }
    return ["identifier": d[kSecCodeInfoIdentifier as String] as? String ?? NSNull(), "team": d[kSecCodeInfoTeamIdentifier as String] as? String ?? NSNull()]
}

func signVerify(_ key: SecKey) -> [String: Any] {
    var err: Unmanaged<CFError>?
    let msg = "gnomon-s0-probe".data(using: .utf8)!
    guard let sig = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, msg as CFData, &err) as Data? else {
        return ["signed": false].merging(cfErr(err)) { a, _ in a }
    }
    guard let pub = SecKeyCopyPublicKey(key) else { return ["signed": true, "verified": false] }
    let ok = SecKeyVerifySignature(pub, .ecdsaSignatureMessageX962SHA256, msg as CFData, sig as CFData, &err)
    let pubData = SecKeyCopyExternalRepresentation(pub, nil) as Data? ?? Data()
    return ["signed": true, "verified": ok, "publicKeySha256": hexPrefix(pubData)]
}

func accessControl() -> SecAccessControl {
    var err: Unmanaged<CFError>?
    guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, [.privateKeyUsage], &err) else {
        emit(["ok": false, "stage": "access-control"].merging(cfErr(err)) { a, _ in a })
    }
    return ac
}

func permQuery(_ tag: String, _ group: String) -> [String: Any] {
    [kSecClass as String: kSecClassKey,
     kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
     kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
     kSecAttrAccessGroup as String: group,
     kSecUseDataProtectionKeychain as String: true]
}

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { emit(["ok": false, "error": "usage"], code: 64) }
if cmd.hasPrefix("se-perm-") {
    guard args.count >= 3 else { emit(["ok": false, "error": "usage"], code: 64) }
    // Aegis H1: never a production tag or group, whatever this binary was signed with
    if args[2] != probeGroup || !args[1].hasPrefix("gnomon-p17-") { emit(["ok": false, "error": "PRODUCTION_NAME", "note": "the probe tool only uses \(probeGroup) and gnomon-p17-* tags"], code: 65) }
}

switch cmd {
case "peer-check":
    guard args.count >= 2 else { emit(["ok": false, "error": "usage"], code: 64) }
    var out: [String: Any] = ["requirement": args[1], "pid": getpid(), "ppid": getppid()]
    var st = stat()
    fstat(0, &st)
    out["stdinIsSocket"] = (st.st_mode & S_IFMT) == S_IFSOCK
    var type: Int32 = 0
    var tlen = socklen_t(MemoryLayout<Int32>.size)
    getsockopt(0, SOL_SOCKET, SO_TYPE, &type, &tlen)
    out["soType"] = type == SOCK_STREAM ? "stream" : (type == SOCK_DGRAM ? "dgram" : "\(type)")
    var ss = sockaddr_storage()
    var slen = socklen_t(MemoryLayout<sockaddr_storage>.size)
    let gn = withUnsafeMutablePointer(to: &ss) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(0, $0, &slen) } }
    out["family"] = gn == 0 ? (Int32(ss.ss_family) == AF_UNIX ? "unix" : "\(ss.ss_family)") : "getsockname failed errno \(errno)"
    // SOL_LOCAL = 0, LOCAL_PEERPID = 0x002, LOCAL_PEERTOKEN = 0x006 (sys/un.h)
    var peerPid: pid_t = 0
    var plen = socklen_t(MemoryLayout<pid_t>.size)
    out["peerPid"] = getsockopt(0, 0, 0x002, &peerPid, &plen) == 0 ? Int(peerPid) : NSNull()
    var tok = audit_token_t()
    var toklen = socklen_t(MemoryLayout<audit_token_t>.size)
    guard getsockopt(0, 0, 0x006, &tok, &toklen) == 0 else {
        emit(out.merging(["ok": false, "stage": "LOCAL_PEERTOKEN", "errno": errno, "strerror": String(cString: strerror(errno))]) { a, _ in a })
    }
    out["tokenPid"] = Int(tok.val.5)
    let tokData = withUnsafeBytes(of: &tok) { Data($0) }
    var code: SecCode?
    let gst = SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributeAudit: tokData] as CFDictionary, [], &code)
    guard gst == errSecSuccess, let c = code else { emit(out.merging(["ok": false, "stage": "SecCodeCopyGuestWithAttributes", "status": Int(gst)]) { a, _ in a }) }
    out["peerSigning"] = signingInfo(c)
    var req: SecRequirement?
    let rst = SecRequirementCreateWithString(args[1] as CFString, [], &req)
    guard rst == errSecSuccess, let r = req else { emit(out.merging(["ok": false, "stage": "requirement", "status": Int(rst)]) { a, _ in a }) }
    let v = SecCodeCheckValidity(c, [], r)
    out["validity"] = Int(v)
    out["valid"] = v == errSecSuccess
    emit(out.merging(["ok": true]) { a, _ in a })

case "se-ephemeral":
    let label = "gnomon-p16-\(UUID().uuidString)"
    var err: Unmanaged<CFError>?
    let attrs: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecAttrLabel as String: label,
        kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: false, kSecAttrAccessControl as String: accessControl()] as [String: Any],
    ]
    let t0 = Date()
    guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, &err) else {
        emit(["ok": false, "stage": "create"].merging(cfErr(err)) { a, _ in a })
    }
    var out: [String: Any] = ["label": label, "createMs": Int(Date().timeIntervalSince(t0) * 1000), "use": signVerify(key)]
    for dp in [true, false] {
        var item: CFTypeRef?
        let q: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrLabel as String: label, kSecReturnRef as String: true, kSecUseDataProtectionKeychain as String: dp]
        out[dp ? "lookupDataProtection" : "lookupLegacy"] = Int(SecItemCopyMatching(q as CFDictionary, &item))
    }
    let ka = SecKeyCopyAttributes(key) as? [String: Any] ?? [:]
    out["attributeKeys"] = Array(ka.keys).sorted()
    if let toid = ka["toid"] as? Data {
        out["tokenBlobBytes"] = toid.count
        if args.count >= 2 {
            FileManager.default.createFile(atPath: args[1], contents: toid.base64EncodedData(), attributes: [.posixPermissions: 0o600])
            out["tokenBlobWritten"] = true
        }
    } else {
        out["tokenBlobBytes"] = 0
    }
    emit(out.merging(["ok": true]) { a, _ in a })

case "se-lookup":
    guard args.count >= 2 else { emit(["ok": false, "error": "usage"], code: 64) }
    var out: [String: Any] = ["label": args[1]]
    for dp in [true, false] {
        var item: CFTypeRef?
        let q: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrLabel as String: args[1], kSecReturnRef as String: true, kSecUseDataProtectionKeychain as String: dp]
        out[dp ? "lookupDataProtection" : "lookupLegacy"] = Int(SecItemCopyMatching(q as CFDictionary, &item))
    }
    emit(out.merging(["ok": true]) { a, _ in a })

case "se-reimport":
    guard args.count >= 2, let b64 = FileManager.default.contents(atPath: args[1]), let blob = Data(base64Encoded: b64) else { emit(["ok": false, "error": "usage or unreadable blob"], code: 64) }
    do {
        let k = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob)
        let sig = try k.signature(for: Data("gnomon-s0-reimport".utf8))
        emit(["ok": true, "reimported": true, "signed": true, "signatureBytes": sig.derRepresentation.count])
    } catch {
        emit(["ok": true, "reimported": false, "error": "\(error)"])
    }

case "se-perm-create":
    var err: Unmanaged<CFError>?
    let attrs: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecAttrAccessGroup as String: args[2],
        kSecUseDataProtectionKeychain as String: true,
        kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: args[1].data(using: .utf8)!, kSecAttrAccessControl as String: accessControl()] as [String: Any],
    ]
    guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, &err) else {
        emit(["ok": false, "stage": "create"].merging(cfErr(err)) { a, _ in a })
    }
    var q = permQuery(args[1], args[2])
    q[kSecReturnAttributes as String] = true
    var item: CFTypeRef?
    let st = SecItemCopyMatching(q as CFDictionary, &item)
    let a = item as? [String: Any] ?? [:]
    emit(["ok": true, "use": signVerify(key), "readback": Int(st), "accessible": a[kSecAttrAccessible as String] as? String ?? NSNull(), "group": a[kSecAttrAccessGroup as String] as? String ?? NSNull()])

case "se-perm-sign":
    var q = permQuery(args[1], args[2])
    q[kSecReturnRef as String] = true
    var item: CFTypeRef?
    let st = SecItemCopyMatching(q as CFDictionary, &item)
    guard st == errSecSuccess, let k = item else { emit(["ok": false, "stage": "load", "status": Int(st)]) }
    let use = signVerify(k as! SecKey)
    emit(["ok": (use["signed"] as? Bool) == true, "use": use])

case "se-perm-delete":
    let st = SecItemDelete(permQuery(args[1], args[2]) as CFDictionary)
    emit(["ok": st == errSecSuccess || st == errSecItemNotFound, "status": Int(st)])

default:
    emit(["ok": false, "error": "unknown command \(cmd)"], code: 64)
}
