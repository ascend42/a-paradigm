// gnomon-helper (darwin) — request handling (moved out of main.swift in
// helper 1.6.0 so tests can drive it: a top-level global in main.swift is
// never initialized under `swift test`). See main.swift for the op list.

import Foundation
import LocalAuthentication
import Security

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

/// One helper process's state: what it holds (Custody) and the keys it created.
final class Server {
    let custody: Custody
    /// Exactly the (key, gen) pairs THIS process created (a failed provision may remove those, and only
    /// those, without presence — Aegis round 3: a pair, never a whole generation).
    var createdHere = Set<String>()

    /// Seams for tests (the arm paths and decision.sign; production: the real prompt, the Secure Enclave key, CGSession).
    let presence: (String) throws -> LAContext
    let signer: (KeyClass, String, LAContext, [Data]) throws -> [String]
    let session: SessionProbe
    /// 1.11.0 (G-HLP-03): the caller check for the ops that need no presence (Caller.swift).
    let caller: CallerGate
    /// 1.11.0: the helper's own items (anchor, presence mode, cert rate), the kernel-cert issuer and the anchor.
    let items: ItemStore
    let issuer: CertIssuer
    let anchor: Anchor
    let modes: ModeStore
    let clock: () -> Date

    init(custody: Custody = Custody(),
         presence: @escaping (String) throws -> LAContext = evaluatePresence,
         signer: @escaping (KeyClass, String, LAContext, [Data]) throws -> [String] = { k, g, ctx, msgs in try signAll(try loadPrivateKey(k, g, context: ctx), msgs) },
         session: SessionProbe = CGSessionProbe(),
         caller: CallerGate = CallerGate(probe: SystemCallerProbe()),
         items: ItemStore = KeychainItemStore(),
         certKey: CertKey = SecureEnclaveCertKey(),
         boot: @escaping () -> String = bootSessionId,
         clock: @escaping () -> Date = Date.init) {
        self.custody = custody
        self.presence = presence
        self.signer = signer
        self.session = session
        self.caller = caller
        self.items = items
        self.clock = clock
        self.issuer = CertIssuer(key: certKey, items: items, boot: boot, clock: clock)
        self.anchor = Anchor(items: items, clock: clock)
        self.modes = ModeStore(items: items)
    }

    func handle(_ req: Json) throws -> Json {
        let op = try str(req, "op")
        switch op {
        case "info":
            let held = custody.sync { (custody.unlocks.count, custody.arms.count) }
            return ["version": gnomonHelperVersion, "protocol": helperProtocol, "pid": Int(getpid()), "sandboxed": false, "signing": signingInfo(), "unlocks": held.0, "arms": held.1, "devKernel": helperAcceptsDevKernel]

        case "presence.available":
            // #setup-preflight (T-2026-10-19-005 MVP-b): canEvaluatePolicy only asks whether a prompt COULD run; it never shows one
            let ctx = LAContext()
            var bioErr: NSError?
            let bio = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &bioErr)
            var anyErr: NSError?
            let any = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &anyErr)
            ctx.invalidate()
            var r: Json = ["available": any, "biometrics": bio]
            if let e = bioErr ?? anyErr { r["error"] = "LAError \(e.code)" }
            return r

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
            if k == .approvals { custody.sync { _ = custody.unlocks.dropAll(); _ = custody.arms.closeAll() } }
            out["deleted"] = deleteKey(k, g)
            createdHere.remove(createdKey(k, g))
            return out

        case "sign":
            let k = try keyClass(req)
            let g = try generation(req)
            let mode = try str(req, "mode")
            // G-BRK-06: neither scope ever lists gnomon:approve-voice:v1 — that domain needs arm.sign
            let msgs = try messages(req, for: k, scope: mode == "cached" ? .cached : .fresh)
            let conn = try connId(req)
            let keep = try optBool(req, "keep")
            let line = helperLine(key: k, messages: msgs)
            switch (k, mode) {
            case (.root, "fresh"):
                // presence PER SIGNATURE: a new context, evaluated, used once, invalidated
                guard !keep else { throw bad("the root key never keeps an unlock") }
                let ctx = try evaluatePresence(promptText(try reason(req), line))
                defer { ctx.invalidate() }
                // "shown": the kernel checks the line names the digest it displayed (provisioner helperLineShows)
                return ["sigs": try signAll(try loadPrivateKey(k, g, context: ctx), msgs), "kept": false, "shown": line]
            case (.approvals, "fresh"):
                if keep && conn == nil { throw bad("keep needs a connId") }
                let epoch0 = custody.epoch
                let ctx = try evaluatePresence(promptText(try reason(req), line))
                let sigs: [String]
                do {
                    sigs = try signAll(try loadPrivateKey(k, g, context: ctx), msgs)
                } catch {
                    ctx.invalidate()
                    throw error
                }
                var kept = false
                // a session event while the prompt was up: the signature stands (the human touched), the unlock is never kept
                if keep, let c = conn { kept = custody.sync { custody.epochIsCurrent(epoch0) && custody.unlocks.put(c, gen: g, ctx: ctx) } }
                if !kept { ctx.invalidate() }
                // 1.7.0 (F4): a kept unlock names its bounds, so the kernel stops assuming the 1.6.0 ones
                return kept ? ["sigs": sigs, "kept": true, "shown": line, "bounds": Bounds.unlockBoundsReply] : ["sigs": sigs, "kept": false, "shown": line]
            case (.approvals, "cached"):
                guard let c = conn else { throw bad("a cached sign needs a connId") }
                return try custody.sync {
                    guard let ctx = custody.unlocks.use(c, gen: g, signatures: msgs.count) else { throw HelperError("no-unlock", "no live unlock for this connection") }
                    do {
                        return ["sigs": try signAll(try loadPrivateKey(k, g, context: ctx), msgs), "kept": true]
                    } catch {
                        custody.unlocks.drop(c) // a context the system invalidated (lock screen, sleep) is gone for good
                        throw HelperError("no-unlock", "the unlock of this connection no longer signs")
                    }
                }
            default:
                throw bad("mode must be fresh (root, approvals) or cached (approvals)")
            }

        case "decision.sign":
            // TD-2026-10-20-514 (1.8.0): ONE fresh presence per card decision. Everything is validated and bound
            // before the prompt (Aegis C1d intent, C3 row table, C7 bounds); then one evaluation signs the approvals messages and every root row, all or nothing.
            guard req["keep"] == nil else { throw bad("decision.sign never keeps an unlock") }
            guard req["mode"] == nil else { throw bad("decision.sign has no mode: it is always one fresh presence") }
            let g = try generation(req)
            _ = try connId(req) // validated (the kernel's connection, informational)
            let batch = try decisionBatch(req)
            if batch.cardKind == "kernel-custody" {
                // 1.11.0: the migration card registers THIS helper's kernel-cert key, never another
                guard batch.rows[1]["certKey"] as? String == (try issuer.key.publicKey()).base64EncodedString() else {
                    throw HelperError("batch-refused", "the kernel-cert key row names another key than this helper's")
                }
            }
            let why = try reason(req)
            let line = try decisionLine(batch)
            let ctx = try presence(decisionPromptText(line, why))
            defer { ctx.invalidate() } // no reuse window, no cached root unlock
            let approvalSigs = batch.approvals.isEmpty ? [] : try signer(.approvals, g, ctx, batch.approvals)
            let rootSigs = try signer(.root, g, ctx, batch.root)
            guard approvalSigs.count == batch.approvals.count, rootSigs.count == batch.root.count else { throw HelperError("sign", "a signature is missing") }
            var out: Json = ["approvalSigs": approvalSigs, "rootSigs": rootSigs, "shown": line, "kept": false]
            if let m = storedModeOf(batch) {
                // 1.11.0 (G-HLP-04): the helper's own copy of the switch, stored only after the row was signed
                out["mode"] = setMode(m)
            }
            return out

        case "arm.open":
            // §14.7: a FRESH presence evaluation, bound to {humanConnId, voiceConnId}, kept per armId
            let a = try armId(req)
            let g = try generation(req)
            let human = try requiredConnId(req, "humanConnId")
            let voice = try requiredConnId(req, "voiceConnId")
            guard human != voice else { throw bad("an arm binds two different connections") }
            guard let hard = try optInt(req, "hardSeconds", max: Bounds.armMaxHardSeconds) else { throw bad("hardSeconds is required") }
            let idle = try optInt(req, "idleSeconds", max: hard)
            // Aegis M2: the decision cap is REQUIRED (D64 `unlimited` is the kernel's to map; the helper ceiling is 1024)
            guard let cap = try optInt(req, "maxSignatures", max: Bounds.armMaxSignatures) else { throw bad("maxSignatures is required (1..\(Bounds.armMaxSignatures))") }
            // the prompt's own messages (the voice-arm card decision, the presence challenge): fresh approvals domains only
            let msgs = try messages(req, for: .approvals, scope: .fresh)
            let why = try reason(req)
            guard why.count <= maxArmReasonChars else { throw bad("an arm reason is at most \(maxArmReasonChars) characters") }
            // Aegis M1: fail closed — no arm opens while the session is locked, off console or unknown
            guard session.usable() else { throw HelperError("session-locked", "the session is locked, switched out or unknown; no arm opens") }
            try armRoom(custody.sync { custody.arms.canOpen(a) })
            let line = armLine(armId: a, humanConnId: human, voiceConnId: voice, hardSeconds: hard, maxSignatures: cap) + "; " + helperLine(key: .approvals, messages: msgs)
            let epoch0 = custody.epoch
            let ctx = try presence(armPromptText(line, why))
            let sigs: [String]
            do {
                sigs = try signer(.approvals, g, ctx, msgs)
            } catch {
                ctx.invalidate()
                throw error
            }
            let put: Arms.Put? = custody.sync {
                // Aegis belt-and-braces: the epoch AND a fresh session check, under the lock, before the arm is kept
                guard custody.epochIsCurrent(epoch0), session.usable() else { return nil }
                return custody.arms.put(a, gen: g, humanConnId: human, voiceConnId: voice, ctx: ctx,
                                        hardSeconds: TimeInterval(hard), idleSeconds: idle.map(TimeInterval.init), maxSignatures: cap)
            }
            guard let p = put else {
                ctx.invalidate()
                throw HelperError("arm-invalidated", "the session locked or slept while the arm prompt was up; the arm was not opened")
            }
            guard p == .ok else {
                ctx.invalidate()
                try armRoom(p)
                throw HelperError("internal", "arm not kept")
            }
            return ["sigs": sigs, "armId": a, "kept": true, "shown": line]

        case "arm.sign":
            let a = try armId(req)
            let g = try generation(req)
            let human = try requiredConnId(req, "humanConnId")
            let voice = try requiredConnId(req, "voiceConnId")
            // G-BRK-06: under an arm only gnomon:approve-voice:v1 — checked before the arm is looked up
            let msgs = try messages(req, for: .approvals, scope: .arm)
            // Aegis H1: each preimage must be the frozen voice-decision layout and name THIS arm and THIS pair
            for m in msgs {
                guard let d = parseVoiceDecision(m) else { throw HelperError("preimage-refused", "not a gnomon:voice-decision:v1 preimage") }
                guard d.armId == a, d.humanConnId == human, d.voiceConnId == voice else {
                    throw HelperError("preimage-refused", "the preimage names another arm or another pair")
                }
            }
            // Aegis M1: a session that is locked, off console or unknown closes every arm instead of signing
            guard session.usable() else {
                custody.invalidateAll()
                throw HelperError("no-arm", "the session is locked, switched out or unknown; every arm was closed")
            }
            return try custody.sync {
                guard let ctx = custody.arms.use(a, gen: g, humanConnId: human, voiceConnId: voice, signatures: msgs.count) else {
                    throw HelperError("no-arm", "no live arm with this id for this pair")
                }
                do {
                    return ["sigs": try signer(.approvals, g, ctx, msgs), "armId": a]
                } catch {
                    custody.arms.close(a) // a context the system invalidated is gone for good
                    throw HelperError("no-arm", "the arm no longer signs")
                }
            }

        case "arm.close":
            let a = try armId(req)
            return ["closed": custody.sync { custody.arms.close(a) }]

        case "arm.close-all":
            return ["closed": custody.sync { custody.arms.closeAll().count }]

        case "conn.close":
            // a connection closed: its cached unlock AND every arm naming it (as human or voice) end
            guard let c = try connId(req) else { throw bad("conn.close needs a connId") }
            let r = custody.sync { (custody.unlocks.drop(c), custody.arms.closeReferencing(c)) }
            return ["dropped": r.0, "arms": r.1]

        case "presence.mode":
            _ = try caller.require()
            let m = try modes.read()
            var out: Json = ["mode": m.mode]
            if let h = m.rowHash { out["rowHash"] = h }
            return out

        case "kernel.cert":
            // 1.11.0 (G-HLP-03): no presence; only the signed kernel instance that spawned this helper
            let who = try caller.require()
            return try issuer.issue(try certRequest(req), caller: who)

        case "anchor.read":
            _ = try caller.require()
            return try anchor.read(req)

        case "anchor.write":
            _ = try caller.require()
            return try anchor.write(req)

        case "unlock.drop":
            guard let c = try connId(req) else { throw bad("unlock.drop needs a connId") }
            return ["dropped": custody.sync { custody.unlocks.drop(c) }]

        case "unlock.drop-all":
            return ["dropped": custody.sync { custody.unlocks.dropAll() }]

        default:
            throw bad("unknown op")
        }
    }

    /// Store the switch; switching ON revokes every click key first (fail closed: an unstored OFF stays ON).
    func setMode(_ m: StoredMode) -> Json {
        if m.mode == "on" { revokeClicks(cause: "mode-on") }
        do {
            try modes.store(m)
            return ["stored": true, "mode": m.mode]
        } catch {
            return ["stored": false, "mode": m.mode]
        }
    }

    /// Click keys (ClickKey.swift, 1.11.0); a no-op until they exist.
    func revokeClicks(cause: String) {}

    private func armRoom(_ p: Arms.Put) throws {
        switch p {
        case .ok: return
        case .exists: throw HelperError("arm-exists", "an arm with this id is live (an arm is never re-opened)")
        case .full: throw HelperError("arm-limit", "\(Bounds.maxArms) arms are held already")
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
    /// EOF: the kernel is gone — every unlock and every arm is invalidated before this returns.
    func serve(onlyOne: Bool, output: Output) -> Int32 {
        let input = FileHandle.standardInput
        var buf = Data()
        var discarding = false
        defer { custody.invalidateAll() }
        while true {
            let chunk = input.availableData
            if chunk.isEmpty { break }
            buf.append(chunk)
            while let nl = buf.firstIndex(of: 0x0A) {
                let line = buf.subdata(in: buf.startIndex..<nl)
                buf.removeSubrange(buf.startIndex...nl)
                if discarding {
                    discarding = false
                    output.emit(replyLine(["id": NSNull(), "ok": false, "error": "bad-request", "message": "line too long"]))
                } else if !line.isEmpty {
                    output.emit(answer(line))
                }
                if onlyOne { return 0 }
            }
            if buf.count > Bounds.maxLineBytes {
                buf.removeAll(keepingCapacity: false)
                discarding = true
            }
        }
        return 0
    }
}
