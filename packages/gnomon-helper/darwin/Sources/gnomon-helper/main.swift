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
//   key.create  {key, gen}                    → {publicKey}   (refuses `exists`)
//   key.public  {key, gen}                    → {publicKey}   (`not-found`)
//   key.delete  {key, gen}                    → {deleted}
//   sign        {key, gen, mode: fresh|cached, connId?, keep?, reason, messages[]}
//                                             → {sigs[], kept}
//   unlock.drop {connId}                      → {dropped}
//   unlock.drop-all                           → {dropped: n}
//
// Refuses to run sandboxed (P8-D68): {"ok":false,"error":"sandboxed"}, exit 3.

import Foundation
import Security

let gnomonHelperVersion = "1.1.0"

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

func handle(_ req: Json) throws -> Json {
    let op = try str(req, "op")
    switch op {
    case "info":
        return ["version": gnomonHelperVersion, "protocol": helperProtocol, "pid": Int(getpid()), "sandboxed": false, "signing": signingInfo(), "unlocks": unlocks.count]

    case "key.create":
        return ["publicKey": try createKey(try keyClass(req), try generation(req))]

    case "key.public":
        return ["publicKey": try publicKeyB64(try loadPrivateKey(try keyClass(req), try generation(req), context: nil))]

    case "key.delete":
        let k = try keyClass(req)
        let g = try generation(req)
        if k == .approvals { _ = unlocks.dropAll() }
        return ["deleted": deleteKey(k, g)]

    case "sign":
        let k = try keyClass(req)
        let g = try generation(req)
        let msgs = try messages(req, for: k)
        let mode = try str(req, "mode")
        let conn = try connId(req)
        let keep = (req["keep"] as? Bool) ?? false
        switch (k, mode) {
        case (.root, "fresh"):
            // presence PER SIGNATURE: a new context, evaluated, used once, invalidated
            guard !keep else { throw bad("the root key never keeps an unlock") }
            let ctx = try evaluatePresence(try reason(req))
            defer { ctx.invalidate() }
            return ["sigs": try signAll(try loadPrivateKey(k, g, context: ctx), msgs), "kept": false]
        case (.approvals, "fresh"):
            if keep && conn == nil { throw bad("keep needs a connId") }
            let ctx = try evaluatePresence(try reason(req))
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
            return ["sigs": sigs, "kept": kept]
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
