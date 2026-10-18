// gnomon-helper (darwin) — the signed helper of the Gnomon kernel (spec §3.1,
// §16, §18; M1.3 slice 1). Holds what the kernel must never hold: the root
// and approvals P-256 keys in the Secure Enclave, behind presence.
//
//   gnomon-helper --version        print the version, exit 0
//   gnomon-helper serve            NDJSON request/reply loop on stdin/stdout
//                                  (the kernel's long-lived child: holds the
//                                  per-connection approvals unlocks; EOF on
//                                  stdin ends it and every unlock with it)
//   gnomon-helper once             one request line in, one reply line out
//                                  (root signatures from the CLI)
//
// Ops (Protocol.swift for the wire format and bounds):
//   info
//   key.list                                  → {keys: [{gen, key}]}
//   key.create  {key, gen, rotate?}           → {publicKey}   (refuses `exists`; refuses `other-generation`
//                                               when a key of another gen exists, unless `rotate` carries
//                                               {fromGen, statement, sig}: a gnomon-root-rotate:v1 row naming
//                                               toGen = gen, signed by the root of fromGen — Aegis H2)
//   key.public  {key, gen}                    → {publicKey}   (`not-found`)
//   key.delete  {key, gen, reason}            → {deleted, statement, sig?}  FRESH presence over a
//                                               helper-composed delete statement, signed by the root of
//                                               gen when it exists (H2); no presence only for a gen this
//                                               process created itself (failed-provision cleanup)
//   sign        {key, gen, mode: fresh|cached, connId?, keep?, reason, messages[]}
//                                             → {sigs[], kept}
//   unlock.drop {connId}                      → {dropped}
//   unlock.drop-all                           → {dropped: n}
//
// Refuses to run sandboxed (P8-D68): {"ok":false,"error":"sandboxed"}, exit 3.

import Foundation
import Security

let gnomonHelperVersion = "1.2.0"

typealias SandboxCheck = @convention(c) (pid_t, UnsafePointer<CChar>?, Int32) -> Int32
func isSandboxed() -> Bool {
    guard let h = dlopen(nil, RTLD_NOW), let s = dlsym(h, "sandbox_check") else { return false }
    return unsafeBitCast(s, to: SandboxCheck.self)(getpid(), nil, 0) != 0
}

func signingInfo() -> Json {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let c = code else { return [:] }
    var st: SecStaticCode?
    SecCodeCopyStaticCode(c, [], &st)
    var info: CFDictionary?
    guard let s = st, SecCodeCopySigningInformation(s, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let d = info as? Json else { return [:] }
    return ["identifier": d[kSecCodeInfoIdentifier as String] as? String ?? NSNull(), "team": d[kSecCodeInfoTeamIdentifier as String] as? String ?? NSNull()]
}

let unlocks = Unlocks()
/// Exactly the (key, gen) pairs THIS process created (a failed provision may remove those, and only
/// those, without presence — Aegis round 3: a pair, never a whole generation).
var createdHere = Set<String>()
func createdKey(_ k: KeyClass, _ g: String) -> String { "\(k.rawValue).\(g)" }

/// Aegis H2: a rotate statement — `gnomon:row-sig:v1\n` + canonical JSON
/// {schemaVersion: gnomon-root-rotate:v1, fromGen, toGen, …} — signed (DER) by the root of fromGen.
func checkRotate(_ req: Json, toGen: String) throws {
    guard let r = req["rotate"] as? Json else { throw HelperError("other-generation", "keys of another generation exist; creating new ones needs a rotate statement signed by the old root") }
    let fromGen = try generation(["gen": r["fromGen"] as Any])
    guard let st = (r["statement"] as? String).flatMap({ Data(base64Encoded: $0) }), st.count <= Bounds.maxMessageBytes,
          let sig = (r["sig"] as? String).flatMap({ Data(base64Encoded: $0) }) else { throw bad("rotate needs {fromGen, statement, sig}") }
    let prefix = Data("gnomon:row-sig:v1\n".utf8)
    guard st.starts(with: prefix), let obj = try? JSONSerialization.jsonObject(with: st.subdata(in: prefix.count..<st.count)) as? Json,
          obj["schemaVersion"] as? String == "gnomon-root-rotate:v1", obj["fromGen"] as? String == fromGen, obj["toGen"] as? String == toGen else {
        throw HelperError("rotate-refused", "the rotate statement does not name this generation change")
    }
    guard verifyBy(.root, fromGen, message: st, signature: sig) else { throw HelperError("rotate-refused", "the rotate statement is not signed by the root of \(fromGen)") }
}

func handle(_ req: Json) throws -> Json {
    let op = try str(req, "op")
    switch op {
    case "info":
        return ["version": gnomonHelperVersion, "protocol": helperProtocol, "pid": Int(getpid()), "sandboxed": false, "signing": signingInfo(), "unlocks": unlocks.count]

    case "key.list":
        return ["keys": listKeys().map { ["gen": $0.gen, "key": $0.key.rawValue] }]

    case "key.create":
        let k = try keyClass(req)
        let g = try generation(req)
        if listKeys().contains(where: { $0.gen != g }) { try checkRotate(req, toGen: g) }
        let pub = try createKey(k, g)
        createdHere.insert(createdKey(k, g))
        return ["publicKey": pub]

    case "key.public":
        return ["publicKey": try publicKeyB64(try loadPrivateKey(try keyClass(req), try generation(req), context: nil))]

    case "key.delete":
        let k = try keyClass(req)
        let g = try generation(req)
        var nonce = Data(count: 16)
        _ = nonce.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        let statement = Data("gnomon:key-delete:v1\n\(k.rawValue)\n\(g)\n\(nonce.base64EncodedString())".utf8)
        var out: Json = ["statement": statement.base64EncodedString()]
        if !createdHere.contains(createdKey(k, g)) {
            // Aegis H2: fresh presence over a statement the HELPER composed; the root of gen signs it when it exists
            let ctx = try evaluatePresence(promptText(try reason(req), "Gnomon Helper: DELETE the \(k.rawValue) key of generation \(g) (\(digest12(statement)))"))
            defer { ctx.invalidate() }
            if let root = try? loadPrivateKey(.root, g, context: ctx) {
                var err: Unmanaged<CFError>?
                guard let sig = SecKeyCreateSignature(root, .ecdsaSignatureMessageX962SHA256, statement as CFData, &err) as Data? else { throw cfError(err, "sign") }
                out["sig"] = sig.base64EncodedString()
            }
        }
        if k == .approvals { _ = unlocks.dropAll() }
        out["deleted"] = deleteKey(k, g)
        createdHere.remove(createdKey(k, g))
        return out

    case "sign":
        let k = try keyClass(req)
        let g = try generation(req)
        let mode = try str(req, "mode")
        let msgs = try messages(req, for: k, cached: mode == "cached")
        let conn = try connId(req)
        let keep = try optBool(req, "keep")
        let line = helperLine(key: k, messages: msgs)
        switch (k, mode) {
        case (.root, "fresh"):
            // presence PER SIGNATURE: a new context, evaluated, used once, invalidated
            guard !keep else { throw bad("the root key never keeps an unlock") }
            let ctx = try evaluatePresence(promptText(try reason(req), line))
            defer { ctx.invalidate() }
            return ["sigs": try signAll(try loadPrivateKey(k, g, context: ctx), msgs), "kept": false]
        case (.approvals, "fresh"):
            if keep && conn == nil { throw bad("keep needs a connId") }
            let ctx = try evaluatePresence(promptText(try reason(req), line))
            let sigs: [String]
            do {
                sigs = try signAll(try loadPrivateKey(k, g, context: ctx), msgs)
            } catch {
                ctx.invalidate()
                throw error
            }
            var kept = false
            if keep, let c = conn { kept = unlocks.put(c, gen: g, ctx: ctx) }
            if !kept { ctx.invalidate() }
            return ["sigs": sigs, "kept": kept, "shown": line]
        case (.approvals, "cached"):
            guard let c = conn else { throw bad("a cached sign needs a connId") }
            guard let ctx = unlocks.use(c, gen: g) else { throw HelperError("no-unlock", "no live unlock for this connection") }
            do {
                return ["sigs": try signAll(try loadPrivateKey(k, g, context: ctx), msgs), "kept": true]
            } catch {
                unlocks.drop(c) // a context the system invalidated (lock screen, sleep) is gone for good
                throw HelperError("no-unlock", "the unlock of this connection no longer signs")
            }
        default:
            throw bad("mode must be fresh (root, approvals) or cached (approvals)")
        }

    case "unlock.drop":
        guard let c = try connId(req) else { throw bad("unlock.drop needs a connId") }
        return ["dropped": unlocks.drop(c)]

    case "unlock.drop-all":
        return ["dropped": unlocks.dropAll()]

    default:
        throw bad("unknown op")
    }
}

/// Answer one raw line. Never throws; the id is echoed when it is an int or a short string.
func answer(_ line: Data) -> Data {
    var id: Any = NSNull()
    guard line.count <= Bounds.maxLineBytes else { return replyLine(["id": id, "ok": false, "error": "bad-request", "message": "line too long"]) }
    guard let obj = try? JSONSerialization.jsonObject(with: line), let req = obj as? Json else {
        return replyLine(["id": id, "ok": false, "error": "bad-request", "message": "not a JSON object"])
    }
    if let n = req["id"] as? Int { id = n } else if let s = req["id"] as? String, s.count <= 64 { id = s }
    do {
        var out = try handle(req)
        out["id"] = id
        out["ok"] = true
        return replyLine(out)
    } catch let e as HelperError {
        var out: Json = ["id": id, "ok": false, "error": e.code, "message": String(e.message.prefix(300))]
        if let s = e.status { out["status"] = s }
        return replyLine(out)
    } catch {
        return replyLine(["id": id, "ok": false, "error": "internal", "message": String("\(error)".prefix(300))])
    }
}

/// Read stdin as raw bytes and split on \n (a UTF-8 character split across reads is never corrupted).
func serve(onlyOne: Bool) -> Int32 {
    let input = FileHandle.standardInput
    var buf = Data()
    var discarding = false
    while true {
        let chunk = input.availableData
        if chunk.isEmpty { break } // EOF: the kernel is gone; the unlocks die with this process
        buf.append(chunk)
        while let nl = buf.firstIndex(of: 0x0A) {
            let line = buf.subdata(in: buf.startIndex..<nl)
            buf.removeSubrange(buf.startIndex...nl)
            if discarding {
                discarding = false
                FileHandle.standardOutput.write(replyLine(["id": NSNull(), "ok": false, "error": "bad-request", "message": "line too long"]))
            } else if !line.isEmpty {
                FileHandle.standardOutput.write(answer(line))
            }
            if onlyOne { return 0 }
        }
        if buf.count > Bounds.maxLineBytes {
            buf.removeAll(keepingCapacity: false)
            discarding = true
        }
    }
    _ = unlocks.dropAll()
    return 0
}

let arguments = Array(CommandLine.arguments.dropFirst())

if arguments.contains("--version") || arguments.contains("-v") {
    print("gnomon-helper \(gnomonHelperVersion)")
    exit(0)
}

if isSandboxed() {
    FileHandle.standardOutput.write(replyLine(["id": NSNull(), "ok": false, "error": "sandboxed", "message": "the helper refuses to run sandboxed (P8-D68)"]))
    exit(3)
}

switch arguments.first {
case "serve":
    exit(serve(onlyOne: false))
case "once":
    exit(serve(onlyOne: true))
default:
    FileHandle.standardError.write(Data("usage: gnomon-helper --version | serve | once\n".utf8))
    exit(64)
}
