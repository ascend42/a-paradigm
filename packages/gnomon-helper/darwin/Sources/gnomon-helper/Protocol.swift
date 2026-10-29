// gnomon-helper (darwin) — the wire protocol `gnomon-helper:v2` (spec §3.1
// root + approvals keys, §16 keys row; M1.3 slice 1; v2 = helper 1.6.0, voice
// arm custody: spec §14.7, S29-K5, S26-C3, G-BRK-06, T-2026-10-19-026).
//
// NDJSON over stdin/stdout: one JSON object per line in, one per line out.
//   request  {"id": <int|string>, "op": "<op>", ...params}
//   reply    {"id": <same>, "ok": true, ...result} | {"id": ..., "ok": false, "error": "<code>", "message"?: "...", "status"?: <OSStatus>}
//   push     {"push": "session", "cause": "<SessionCause>", "arms": [armId…], "unlocks": <n>, "seq": <n>}   (v2)
//            UNSOLICITED and never carries an `id`. The helper saw a screen lock, screensaver,
//            display sleep, system sleep or user switch, and it has ALREADY invalidated every arm
//            and every cached unlock (SessionWatch.swift). A push is written whole and is never
//            interleaved with a reply (Output.emit).
//
// Output NEVER carries private key material (a Secure Enclave key cannot be
// exported anyway): only public keys (X9.63, base64), DER signatures and
// error codes. Every input is bounded and validated here, before any key is
// touched; a bad request is refused with `bad-request`.

import CryptoKit
import Foundation

/// The helper's version (`--version`, `info`): the kernel's floor is MIN_HELPER_VERSION (identity/helper.ts).
/// 1.6.0: protocol v2 — voice arms (own store and caps), the approve-voice domain under an arm only, the
/// session observer and its push, conn.close.
/// 1.7.0 (TD-2026-10-20-086 F4/F5): a cached unlock lasts until screen lock, sleep or user switch (SessionWatch),
/// capped at 12 h and 512 signatures, and a kept fresh sign reports those bounds (`bounds`) so the kernel can stop
/// applying the 1.6.0 bounds. The unlock key is still the request's `connId` string; the kernel now sends the GUI
/// device's `udev:` key there, so the unlock survives a reconnect. Same protocol (additive reply field).
/// 1.8.0 (TD-2026-10-20-514; Aegis C1-C3, C7): `decision.sign` — ONE fresh presence signs a card decision's
/// approvals messages (decisionSig + presence challenge) AND every root row it needs: the gnomon-root-decision:v2
/// row (rowsDigest over the card's detail.rootRows, sent as `intent`) and the rows the card showed, in order, within
/// the card kind's closed row table. The helper's own line (what every row grants, every digest) goes FIRST in the
/// dialog; the context is invalidated at once — never cached, never kept. `probe-decision` is the on-device check
/// (C4). Additive op: same protocol, the kernel's 1.6.0 floor stays; the kernel picks decision.sign from info.version.
/// 1.9.0 (TD-2026-10-22-769): two row tables the 1.8.0 release did not carry — `loop-trust` (one loop.trusted row;
/// `requestedBy`, the agent that asked, is in its field set) and `local.config` (one gnomon-root-local:v1 row: a real
/// home's local-model config, loopback endpoints only, at most 4, the runner pinned by sha256). The kernel refuses a
/// card of either kind when it is RAISED on an older helper ("update the Gnomon app"). Same protocol, additive.
/// 1.10.0 (TD-2026-10-28-969, C6'a2-h, G-HLP-02): the `permission` row table — a destructive brokered Always signs
/// its gnomon-root-decision:v2 row ONLY (rootRows:[]), and any further row is refused. The kernel offers a
/// destructive Always only from this version (ROW_TABLE_MIN_HELPER.permission); an older helper keeps allow and deny.
/// Same protocol, additive.
let gnomonHelperVersion = "1.10.0"
let helperProtocol = "gnomon-helper:v2"

/// Bounds (attacker-growable inputs are capped before use).
enum Bounds {
    static let maxLineBytes = 1 << 20          // one request line
    static let maxMessages = 4                 // per sign request
    static let maxDecisionMessages = 10        // per decision.sign request (approvals + root, TD-2026-10-20-514)
    static let maxDecisionApprovals = 2        // decision.sign: one approve:v1 and one presence:v1 at most
    static let maxDecisionRootRows = 8         // decision.sign: the decision row + every grant row of one card
    static let maxDecisionBytes = 256 * 1024   // decision.sign: total decoded bytes (approvals + root + intent), Aegis C7
    static let maxDecisionLineChars = 1200     // decision.sign: the helper's own dialog line (UTF-16 units), never truncated
    static let maxDecisionReasonChars = 160    // decision.sign: the kernel's text, AFTER the helper's line
    static let maxMessageBytes = 65_536        // per message, decoded
    static let maxReasonChars = 512            // the caller's part of the presence prompt (the helper appends its own line)
    static let maxConnIdChars = 128
    static let maxUnlocks = 32                 // per-connection unlocks held at once
    // TD-2026-10-20-086 F4 (1.7.0): no separate idle limit — the session observer ends the unlock at screen lock,
    // screensaver, display or system sleep and user switch; the two HARD bounds below end it too, whatever the
    // kernel says (the broker enforces the same pair, broker/unlock.ts; 1.6.0 was 15 min idle / 60 min / 64):
    static let unlockAbsoluteSeconds: TimeInterval = 12 * 60 * 60   // from the presence that opened it
    static let unlockIdleSeconds: TimeInterval = unlockAbsoluteSeconds
    static let maxSignaturesPerUnlock = 512                          // signatures made under it
    /// What a kept fresh sign reports (`bounds`), so the kernel opens its record with the same caps.
    static var unlockBoundsReply: Json {
        ["idleSeconds": Int(unlockIdleSeconds), "absoluteSeconds": Int(unlockAbsoluteSeconds), "maxSignatures": maxSignaturesPerUnlock]
    }
    // Voice arms (§14.7, S29-K5): their OWN store and their OWN caps, never shared with the
    // per-connId unlocks above (an arm never counts against maxUnlocks, nor an unlock against maxArms).
    static let maxArms = 8                                      // arms held at once
    static let maxArmIdChars = 64
    static let armMaxHardSeconds = 240 * 60                     // reversible hardMinutes ≤ 240 (§14.7); gate ≤ 60 is the kernel's tighter bound
    static let armMaxSignatures = 1024                          // the helper's ceiling; D64 `unlimited` maps here
}

/// The key classes the helper holds (§3.1). Each may sign only preimages that
/// start with one of its domains — the kernel prepends the domain, the helper
/// re-checks it, so a request can never make the approvals key sign a row or
/// the root key sign a decision.
enum KeyClass: String {
    case root
    case approvals

    /// Fresh-presence signatures (round 2, M1: the root signs rows only).
    var allowedDomains: [String] {
        switch self {
        case .root: return ["gnomon:row-sig:v1\n"]
        case .approvals: return ["gnomon:approve:v1\n", "gnomon:presence:v1\n"]
        }
    }

    /// Under a CACHED unlock only decisions are signed (round 2, M1): never a presence attestation,
    /// and never a VOICE decision (G-BRK-06: that domain is signed only under a live arm).
    static let cachedDomains = ["gnomon:approve:v1\n"]

    /// Under a live voice ARM only voice decisions are signed (§14.7, G-BRK-06): never a hand decision
    /// (`approve:v1`) and never a presence attestation. This domain is in NO other list, so neither a
    /// fresh prompt nor a cached connId unlock can ever produce a voice signature.
    static let armDomains = ["gnomon:approve-voice:v1\n"]
}

/// Which unlock a sign runs under; each has its own domain allowlist (checked before any key is touched).
enum SignScope {
    case fresh   // a presence prompt now: the key's allowedDomains
    case cached  // a per-connId cached unlock: cachedDomains
    case arm     // a per-armId voice arm: armDomains (approvals key only)

    func allowed(_ key: KeyClass) -> [String] {
        switch self {
        case .fresh: return key.allowedDomains
        case .cached: return KeyClass.cachedDomains
        case .arm: return key == .approvals ? KeyClass.armDomains : []
        }
    }

    var label: String {
        switch self {
        case .fresh: return ""
        case .cached: return " under a cached unlock"
        case .arm: return " under a voice arm"
        }
    }
}

struct HelperError: Error {
    let code: String
    let message: String
    let status: Int?

    init(_ code: String, _ message: String, status: Int? = nil) {
        self.code = code
        self.message = message
        self.status = status
    }
}

typealias Json = [String: Any]

func bad(_ message: String) -> HelperError { HelperError("bad-request", message) }

func str(_ req: Json, _ key: String) throws -> String {
    guard let v = req[key] as? String else { throw bad("\(key) must be a string") }
    return v
}

func optStr(_ req: Json, _ key: String) throws -> String? {
    guard let v = req[key] else { return nil }
    guard let s = v as? String else { throw bad("\(key) must be a string") }
    return s
}

func keyClass(_ req: Json) throws -> KeyClass {
    guard let k = KeyClass(rawValue: try str(req, "key")) else { throw bad("key must be root or approvals") }
    return k
}

/// The key generation id the kernel chose at `gnomon identity init`: [a-z0-9]{4,32}.
func generation(_ req: Json) throws -> String {
    let g = try str(req, "gen")
    let ok = g.count >= 4 && g.count <= 32 && g.unicodeScalars.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) }
    guard ok else { throw bad("gen must match [a-z0-9]{4,32}") }
    return g
}

func validConnId(_ c: String) -> Bool {
    !c.isEmpty && c.count <= Bounds.maxConnIdChars && c.unicodeScalars.allSatisfy {
        ("a"..."z").contains($0) || ("A"..."Z").contains($0) || ("0"..."9").contains($0) || $0 == ":" || $0 == "-" || $0 == "_"
    }
}

func connId(_ req: Json, _ key: String = "connId") throws -> String? {
    guard let c = try optStr(req, key) else { return nil }
    guard validConnId(c) else { throw bad("\(key) must match [A-Za-z0-9:_-]{1,128}") }
    return c
}

/// A connId the op cannot do without (the arm ops name both connections of the pair).
func requiredConnId(_ req: Json, _ key: String) throws -> String {
    guard let c = try connId(req, key) else { throw bad("\(key) is required") }
    return c
}

/// An arm id: `arm:` + a ULID (contracts ID_PATTERNS.arm: [0-7] then 25 Crockford base32), ≤ maxArmIdChars.
func armId(_ req: Json) throws -> String {
    let a = try str(req, "armId")
    guard a.count <= Bounds.maxArmIdChars, a.hasPrefix("arm:") else { throw bad("armId must be arm:<ULID>") }
    let body = Array(a.dropFirst(4).unicodeScalars)
    let crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".unicodeScalars
    let ok = body.count == 26 && ("0"..."7").contains(body[0]) && body.allSatisfy { crockford.contains($0) }
    guard ok else { throw bad("armId must be arm:<ULID>") }
    return a
}

/// An optional integer in 1...max (a JSON number with no fraction, never a boolean).
func optInt(_ req: Json, _ key: String, max: Int) throws -> Int? {
    guard let v = req[key] else { return nil }
    guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { throw bad("\(key) must be an integer 1..\(max)") }
    let d = n.doubleValue
    guard d.rounded() == d, d >= 1, d <= Double(max) else { throw bad("\(key) must be an integer 1..\(max)") }
    return Int(d)
}

/// The messages to sign: 1..4 base64 strings, each ≤ 64 KiB decoded, each starting with a domain that
/// `scope` allows for `key` (a fresh prompt, a cached connId unlock, or a voice arm).
func messages(_ req: Json, for key: KeyClass, scope: SignScope = .fresh) throws -> [Data] {
    let allowed = scope.allowed(key)
    guard let arr = req["messages"] as? [Any], !arr.isEmpty, arr.count <= Bounds.maxMessages else {
        throw bad("messages must be an array of 1..\(Bounds.maxMessages) base64 strings")
    }
    return try arr.map { item in
        guard let s = item as? String, let d = Data(base64Encoded: s), !d.isEmpty, d.count <= Bounds.maxMessageBytes else {
            throw bad("each message must be base64 of 1..\(Bounds.maxMessageBytes) bytes")
        }
        guard allowed.contains(where: { d.starts(with: Data($0.utf8)) }) else {
            throw HelperError("domain-refused", "the \(key.rawValue) key does not sign this domain\(scope.label)")
        }
        return d
    }
}

func reason(_ req: Json) throws -> String {
    let r = try str(req, "reason")
    guard !r.isEmpty, r.count <= Bounds.maxReasonChars else { throw bad("reason must be 1..\(Bounds.maxReasonChars) characters") }
    return r
}

/// Serialize one reply line (sorted keys, so the output is deterministic).
func replyLine(_ d: Json) -> Data {
    var data = (try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])) ?? Data(#"{"ok":false,"error":"internal"}"#.utf8)
    data.append(0x0A)
    return data
}

/// A strict JSON boolean (round 2, R7): NSNumber 0/1 is not a boolean.
func optBool(_ req: Json, _ key: String) throws -> Bool {
    guard let v = req[key] else { return false }
    guard let n = v as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { throw bad("\(key) must be a boolean") }
    return n.boolValue
}

/// sha256 hex prefix (12) of bytes: what the helper's own prompt line shows, and the kernel shows too (H3).
func digest12(_ d: Data) -> String {
    SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined().prefix(12).description
}

/// The helper's OWN prompt line (Aegis H3): computed from what it signs, appended after the caller's
/// text; the caller cannot suppress or replace it.
func helperLine(key: KeyClass, messages: [Data]) -> String {
    var parts = ["Gnomon Helper: \(key.rawValue) key signs \(messages.count): " + messages.map(digest12).joined(separator: " ")]
    for m in messages {
        guard let nl = m.firstIndex(of: 0x0A) else { continue }
        let domain = String(decoding: m[m.startIndex..<nl], as: UTF8.self)
        if domain == "gnomon:row-sig:v1", let obj = try? JSONSerialization.jsonObject(with: m[(nl + 1)...]) as? Json {
            var what = (obj["schemaVersion"] as? String) ?? "row"
            if let k = obj["kind"] as? String { what += " " + k }
            if let c = obj["cardId"] as? String { what += " card " + String(c.prefix(40)) }
            if let h = obj["contentHash"] as? String { what += " " + String(h.prefix(19)) }
            parts.append("row " + String(what.prefix(160)))
        } else if domain == "gnomon:approve:v1" {
            var fields = String(decoding: m[(nl + 1)...], as: UTF8.self).split(separator: "\n", omittingEmptySubsequences: false)
            // decisionSig v2 (P8-D98): first line gnomon:decision:v2, then the v1 fields, then the answer digest
            let v2 = fields.first == "gnomon:decision:v2"
            if v2 { fields.removeFirst() }
            if fields.count >= 3 {
                var line = "decision \(fields[1].prefix(24)) on \(fields[0].prefix(40)) \(fields[2].prefix(19))"
                if v2, fields.count >= 5 { line += " answer \(fields[4].prefix(19))" }
                parts.append(line)
            }
        }
    }
    return parts.joined(separator: "; ")
}

/* ── decision.sign (helper 1.8.0, TD-2026-10-20-514; Aegis C1–C3, C7) ──────── */

let approveDomain = "gnomon:approve:v1\n"
let presenceDomain = "gnomon:presence:v1\n"
let rowDomain = "gnomon:row-sig:v1\n"
let rootDecisionSchemaV1 = "gnomon-root-decision:v1"
let rootDecisionSchemaV2 = "gnomon-root-decision:v2"
let voiceEnrolSchema = "voiceEnrolRow:v1"

/// What an approve:v1 message names: (cardId, decision, contentHash), v1 or decisionSig v2 layout. nil = not that layout.
struct ApproveFields: Equatable {
    let cardId: String
    let decision: String
    let contentHash: String
}

func parseApprove(_ m: Data) -> ApproveFields? {
    let d = Data(approveDomain.utf8)
    guard m.starts(with: d) else { return nil }
    var f = String(decoding: m[(m.startIndex + d.count)...], as: UTF8.self).split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    // decisionSig v2 (P8-D98): first line gnomon:decision:v2, then the v1 fields, then the answer digest
    if f.first == "gnomon:decision:v2" { f.removeFirst() }
    guard f.count >= 4, !f[0].isEmpty, !f[1].isEmpty, !f[2].isEmpty else { return nil }
    return ApproveFields(cardId: f[0], decision: f[1], contentHash: f[2])
}

/// A decision.sign batch, validated and bound (decisionBatch).
struct DecisionBatch {
    let approvals: [Data]
    let root: [Data]
    /// root rows parsed; rows[0] is the gnomon-root-decision:v2 row
    let rows: [Json]
    let anchor: ApproveFields
    let cardKind: String
}

struct BatchRefusal: Error {
    let why: String
}

/// The kind a root row names in the closed table: a grant row's `kind`, `voice.enrol` for an enrol row, else its schemaVersion.
func rowKind(_ r: Json) -> String {
    if r["schemaVersion"] as? String == voiceEnrolSchema { return r["op"] as? String == "enrol" ? "voice.enrol" : "voice.\(r["op"] as? String ?? "?")" }
    return (r["kind"] as? String) ?? (r["schemaVersion"] as? String) ?? "row"
}

/// The fields a row's intent (detail.rootRows) leaves out: set when the row is built, never shown on the card.
func volatileFields(_ r: Json) -> [String] {
    r["schemaVersion"] as? String == voiceEnrolSchema ? ["createdAt", "seq", "at"] : ["createdAt"]
}

/// Aegis C3: the closed per-cardKind row table (rows after the decision row). nil = allowed.
func rowTableRefusal(cardKind: String, rows: [Json]) -> String? {
    let kinds = rows.map(rowKind)
    switch cardKind {
    case "install":
        guard kinds.filter({ $0 == "grant.install" }).count == 1, kinds.last == "grant.install" else { return "an install signs exactly one grant.install, last" }
        for k in kinds.dropLast() {
            guard ["grant.trust", "grant.capability", "grant.egress", "grant.publisher"].contains(k) else { return "an install never signs a \(k) row" }
            guard kinds.filter({ $0 == k }).count <= 1 else { return "an install signs at most one \(k) row" }
        }
        if let c = rows.first(where: { rowKind($0) == "grant.capability" }) {
            guard c["manifestHash"] is String, c["deviceId"] == nil else { return "an install's capability row names its manifest, never a device" }
        }
        if let p = rows.first(where: { rowKind($0) == "grant.publisher" }) {
            let name = rows.last?["name"] as? String ?? ""
            guard let pub = p["publisher"] as? String, name.hasPrefix(pub + ".") else { return "the publisher row names another publisher than the installed mod" }
        }
        return nil
    case "uninstall":
        return kinds == ["grant.uninstall"] ? nil : "an uninstall signs exactly one grant.uninstall"
    case "voice.enrol":
        return kinds == ["voice.enrol"] ? nil : "a voice enrolment signs exactly one enrol row"
    case "loop-trust":
        // 8.0:loops (gnomon-loops.md §3.1): a loop trust signs exactly one loop.trusted row naming the loop and its hash
        guard kinds == ["loop.trusted"] else { return "a loop-trust signs exactly one loop.trusted row" }
        let r = rows[0]
        // 1.9.0: requestedBy (the agent that asked, #loop-agent-ops) is part of the closed set
        let fields: Set<String> = ["kind", "loopId", "scope", "repoKey", "contentHash", "coreHash", "closureDigest", "sourceHash", "cardId", "by", "requestedBy", "createdAt"]
        for k in r.keys.sorted() where !fields.contains(k) { return "a loop.trusted row never carries \(String(k.prefix(40)))" }
        func isHash(_ v: Any?) -> Bool { (v as? String).map { fullMatch($0, "^sha256:[0-9a-f]{64}$") } ?? false }
        guard let l = r["loopId"] as? String, fullMatch(l, "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"),
              let sc = r["scope"] as? String, sc == "repo" || sc == "personal", isHash(r["repoKey"]), isHash(r["contentHash"]) else { return "a loop.trusted row names its loop, scope, repo and content hash" }
        for k in ["coreHash", "closureDigest"] where r[k] != nil && !isHash(r[k]) { return "a loop.trusted \(k) is sha256:<64 hex>" }
        if let v = r["sourceHash"], !((v as? String).map { fullMatch($0, "^[0-9a-f]{64}$") } ?? false) { return "a loop.trusted sourceHash is 64 hex" }
        // Aegis L7 (1.9.0): who decided and who asked are principals (by may be "root" for an agent-raised card)
        if !((r["by"] as? String) == "root" || isPrincipal(r["by"])) { return "a loop.trusted by is a principal" }
        if let v = r["requestedBy"], !isPrincipal(v) { return "a loop.trusted requestedBy is a principal" }
        return nil
    case "local.config":
        // TD-2026-10-22-769 (1.9.0): a real home's local-model config signs exactly one gnomon-root-local:v1 row
        guard kinds == [localRootSchema] else { return "a local.config signs exactly one gnomon-root-local:v1 row" }
        return localRowRefusal(rows[0])
    case "presence.mode":
        // 1.11.0 (TD-2026-10-29-340/-894, G-HLP-04): the global Touch ID switch signs exactly one mode row
        guard kinds == [presenceModeSchema] else { return "a presence.mode signs exactly one gnomon-presence-mode:v1 row" }
        return presenceModeRowRefusal(rows[0])
    case "kernel-custody":
        // 1.11.0 (TD-2026-10-29-746): the migration card registers the kernel-cert key, then seals the legacy kernel keys
        guard kinds == [kernelCertKeySchema, kernelLegacySchema] else { return "a kernel-custody signs a gnomon-kernel-cert-key:v1 row, then a gnomon-kernel-legacy:v1 row" }
        return kernelCustodyRefusal(rows)
    case "permission", "mod.mcp.config", "api-token", "peer-pair", "grant":
        // 1.10.0 (G-HLP-02): a destructive brokered Always (`permission`) signs its decision row only, like these
        return kinds.isEmpty ? nil : "a \(cardKind) decision signs only its decision row"
    default:
        return "no row table for card kind \(String(cardKind.prefix(40)))"
    }
}

/// The whole string matches `pattern` (ASCII classes only). A bare `range(of:)` with ^…$ would accept a trailing line
/// terminator under ICU, which JavaScript's `$` does not: requiring the match to span the string keeps the mirrors equal.
func fullMatch(_ s: String, _ pattern: String) -> Bool {
    s.range(of: pattern, options: .regularExpression) == s.startIndex..<s.endIndex
}

/// A principal id (the contracts' ANY_PRINCIPAL_PATTERN), at most 128 UTF-16 units.
func isPrincipal(_ v: Any?) -> Bool {
    guard let s = v as? String, s.utf16.count <= 128 else { return false }
    return fullMatch(s, "^p:[0-9a-hjkmnp-tv-z]{8}/[a-z0-9][a-z0-9._-]{0,63}(?:@[0-9a-f]{8})?$")
}

let localRootSchema = "gnomon-root-local:v1"
/// Aegis M1: the runner dir and node path are always shown in full, so each is capped.
let localPathMax = 256
let localRowMaxEndpoints = 4
/// The local transports (the kernel's LOCAL_COMPAT_NAMES; parity-tested through the shared vectors).
let localCompats: Set<String> = ["llama.cpp", "ollama", "lm-studio", "vllm", "mlx-lm"]

private func isJsonBool(_ v: Any?) -> Bool { (v as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } ?? false }
/// A JSON whole number in 0...2^53-1 (the TS mirror's Number.isSafeInteger, non-negative), never a boolean.
private func jsonWhole(_ v: Any?) -> Int64? {
    guard let n = v as? NSNumber, !isJsonBool(n) else { return nil }
    let d = n.doubleValue
    guard d.isFinite, d >= 0, d <= 9_007_199_254_740_991, d == d.rounded() else { return nil }
    return Int64(d)
}
private func str(_ v: Any?, _ max: Int) -> String? {
    guard let s = v as? String, !s.isEmpty, s.utf16.count <= max else { return nil }
    return s
}

/// The local.config row check (mirror of localRowRefusal in the kernel's decision-batch.ts). nil = allowed.
func localRowRefusal(_ r: Json) -> String? {
    let rowFields: Set<String> = ["schemaVersion", "version", "local", "cardId", "runnerSource", "createdAt"]
    for k in r.keys.sorted() where !rowFields.contains(k) { return "a local config row never carries \(String(k.prefix(40)))" }
    guard jsonWhole(r["version"]) != nil else { return "a local config row names its version (a whole number)" }
    guard let src = r["runnerSource"] as? String, src == "bundled" || src == "override" else { return "a local config row says whether its runner is bundled or an override" }
    guard let l = r["local"] as? Json else { return "a local config row names its local section" }
    for k in l.keys.sorted() where !["endpoints", "runner"].contains(k) { return "a local config never carries \(String(k.prefix(40)))" }
    guard let eps = l["endpoints"] as? [Any], eps.count >= 1, eps.count <= localRowMaxEndpoints else { return "a local config names 1..\(localRowMaxEndpoints) endpoints" }
    let epFields: Set<String> = ["id", "base", "model", "compat", "loops"]
    for raw in eps {
        guard let e = raw as? Json else { return "a local endpoint is an object" }
        for k in e.keys.sorted() where !epFields.contains(k) { return "a local endpoint never carries \(String(k.prefix(40)))" }
        guard let id = str(e["id"], 64), fullMatch(id, "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"), str(e["model"], 128) != nil,
              let compat = str(e["compat"], 32), localCompats.contains(compat) else { return "a local endpoint names its id, model and a local compat" }
        let loopback = "^https?://(?:127\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}|localhost|\\[::1\\])(?::([0-9]{1,5}))?(?:/[A-Za-z0-9._~%/-]*)?$"
        guard let base = str(e["base"], 256), fullMatch(base, loopback) else { return "a local endpoint is loopback only in 8.0" }
        if let port = loopbackPortDigits(base), port < 1 || port > 65535 { return "a local endpoint is loopback only in 8.0" }
        if let v = e["loops"], !isJsonBool(v) { return "a local endpoint loops flag is true or false" }
    }
    guard let ru = l["runner"] as? Json else { return "a local config pins its runner" }
    for k in ru.keys.sorted() where !["node", "nodeSha256", "dir", "treeSha256", "entry"].contains(k) { return "a local runner pin never carries \(String(k.prefix(40)))" }
    func absPosix(_ v: String) -> Bool { v.hasPrefix("/") && !v.contains("\u{0}") }
    guard let node = str(ru["node"], localPathMax), absPosix(node), let dir = str(ru["dir"], localPathMax), absPosix(dir),
          let ns = ru["nodeSha256"] as? String, fullMatch(ns, "^[0-9a-f]{64}$"), let ts = ru["treeSha256"] as? String, fullMatch(ts, "^[0-9a-f]{64}$"),
          let entry = str(ru["entry"], 128), fullMatch(entry, "^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$"), !entry.split(separator: "/", omittingEmptySubsequences: false).contains("..")
    else { return "a local runner pin names node, its sha256, the dir, its tree sha256 and the entry" }
    return nil
}

let presenceModeSchema = "gnomon-presence-mode:v1"
let kernelCertKeySchema = "gnomon-kernel-cert-key:v1"
let kernelLegacySchema = "gnomon-kernel-legacy:v1"
let kernelLegacyMaxKeys = 64

/// A closed field set: nil = only these keys.
private func onlyFields(_ r: Json, _ fields: Set<String>, _ what: String) -> String? {
    for k in r.keys.sorted() where !fields.contains(k) { return "a \(what) row never carries \(String(k.prefix(40)))" }
    return nil
}

/// 1.11.0: the presence.mode row (mirror of presenceModeRowRefusal in decision-batch.ts). nil = allowed.
func presenceModeRowRefusal(_ r: Json) -> String? {
    if let e = onlyFields(r, ["schemaVersion", "mode", "cardId", "createdAt"], "presence mode") { return e }
    guard let m = r["mode"] as? String, m == "on" || m == "off" else { return "a presence mode row names on or off" }
    return nil
}

/// 1.11.0: the kernel-custody rows (mirror of kernelCustodyRefusal). rows = [cert-key row, legacy row]. nil = allowed.
func kernelCustodyRefusal(_ rows: [Json]) -> String? {
    let k = rows[0], l = rows[1]
    if let e = onlyFields(k, ["schemaVersion", "certKey", "certKeyId", "cardId", "createdAt"], "kernel-cert key") { return e }
    guard let b64 = k["certKey"] as? String, b64.count == 88, let raw = Data(base64Encoded: b64), raw.count == 65, raw.first == 0x04,
          raw.base64EncodedString() == b64 else { return "a kernel-cert key row names a P-256 X9.63 public key" }
    guard k["certKeyId"] as? String == sha256Tag(raw) else { return "a kernel-cert key row's certKeyId is sha256 of its key" }
    if let e = onlyFields(l, ["schemaVersion", "keyIds", "logId", "headSeq", "headHash", "cardId", "createdAt"], "kernel legacy") { return e }
    guard let ids = l["keyIds"] as? [Any], ids.count >= 1, ids.count <= kernelLegacyMaxKeys else { return "a kernel legacy row seals 1..\(kernelLegacyMaxKeys) key ids" }
    var seen = Set<String>()
    for v in ids {
        guard let s = v as? String, fullMatch(s, "^gkey:v1:[0-9a-f]{64}$"), seen.insert(s).inserted else { return "a kernel legacy key id is a unique gkey:v1:<64 hex>" }
    }
    guard let log = l["logId"] as? String, fullMatch(log, "^log:[0-9A-HJKMNP-TV-Z]{26}$") else { return "a kernel legacy row names its log" }
    guard jsonWhole(l["headSeq"]) != nil else { return "a kernel legacy row names its head seq (a whole number)" }
    guard let h = l["headHash"] as? String, fullMatch(h, "^sha256:[0-9a-f]{64}$") else { return "a kernel legacy row names its head hash" }
    return nil
}

/// The digits after the loopback host's `:` (the base already matched the loopback pattern), or nil when it names none.
private func loopbackPortDigits(_ base: String) -> Int? {
    guard let afterScheme = base.range(of: "://") else { return nil }
    let rest = base[afterScheme.upperBound...]
    let hostPort = rest.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
    guard let colon = hostPort.lastIndex(of: ":"), !hostPort.hasSuffix("]") else { return nil }
    return Int(hostPort[hostPort.index(after: colon)...])
}

/// C2 for a local config row (mirror of localRowShown): the version, every endpoint in full, then the runner IN FULL
/// (Aegis M1: never compacted; a row that does not fit is refused too-large-to-show). An override runner is marked.
func localRowShown(_ r: Json) -> String? {
    guard let l = r["local"] as? Json, let eps = l["endpoints"] as? [Any], let ru = l["runner"] as? Json, let version = jsonWhole(r["version"]) else { return nil }
    var parts: [String] = []
    for raw in eps {
        guard let e = raw as? Json, let id = e["id"] as? String, let base = e["base"] as? String, let model = e["model"] as? String, let compat = e["compat"] as? String else { return nil }
        let loops = isJsonBool(e["loops"]) && (e["loops"] as? NSNumber)?.boolValue == true
        parts.append("endpoint \(id) \(base) model \(model) (\(compat))\(loops ? " loops: yes" : " loops: no")")
    }
    guard let dir = ru["dir"] as? String, let tree = ru["treeSha256"] as? String, let node = ru["node"] as? String, let nodeSha = ru["nodeSha256"] as? String, let entry = ru["entry"] as? String else { return nil }
    let which = (r["runnerSource"] as? String) == "override" ? "OVERRIDE runner" : "bundled runner"
    return "local model config v\(version): \(parts.joined(separator: ", ")); \(which) \(dir)/\(entry) tree \(tree.prefix(12)) node \(node) \(nodeSha.prefix(12))"
}

func sha256Tag(_ d: Data) -> String {
    "sha256:" + SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined()
}

/// THE binding rule of a decision batch (TD-2026-10-20-514 + Aegis C1d/C3; the kernel's mirror is gnomon
/// src/kernel/identity/decision-batch.ts, both checked against gnomon-contracts
/// test/fixtures/decision-batch-vectors.json). Throws BatchRefusal (`batch-refused`).
///   - rows[0] is the ONE gnomon-root-decision:v2 row {cardId, cardKind, decision, contentHash, approver, rowsDigest};
///     no other decision row anywhere. An approve message, when present, names the same cardId/decision/contentHash.
///   - sha256(intent) == rowsDigest, and each later row with its volatile fields dropped deep-equals intent[i]
///     (same count, same order): what the card showed (detail.rootRows, inside contentHash) is what gets signed.
///   - every later row carries the anchor's cardId; every manifestHash is the same one; the cardKind's row table holds.
/// Aegis F2: JSON equality with the TS mirror's canonicalJson semantics. NSDictionary.isEqual says true == 1 and
/// 1.0 == 1; here a boolean never equals a number, numbers compare by value (JS: 1 and 1.0 are one number), and
/// strings, null, arrays and objects compare strictly and recursively.
func jsonStrictEqual(_ a: Any, _ b: Any) -> Bool {
    func isBool(_ x: Any) -> Bool { (x as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } ?? false }
    if a is NSNull || b is NSNull { return a is NSNull && b is NSNull }
    if let x = a as? String { return (b as? String) == x }
    if b is String { return false }
    if let x = a as? NSNumber, let y = b as? NSNumber {
        if isBool(x) || isBool(y) { return isBool(x) && isBool(y) && x.boolValue == y.boolValue }
        return x.doubleValue == y.doubleValue
    }
    if let x = a as? [Any], let y = b as? [Any] { return x.count == y.count && zip(x, y).allSatisfy { jsonStrictEqual($0, $1) } }
    if let x = a as? [String: Any], let y = b as? [String: Any] {
        return x.count == y.count && x.allSatisfy { k, v in y[k].map { jsonStrictEqual(v, $0) } ?? false }
    }
    return false
}

/// Tighten here AND in the TS mirror (one function each side) — the shared vectors keep them equal.
func bindDecisionBatch(approve: ApproveFields?, rows: [Json], intent: Data) throws -> (anchor: ApproveFields, cardKind: String) {
    guard let d = rows.first, d["schemaVersion"] as? String == rootDecisionSchemaV2 else { throw BatchRefusal(why: "the first root row is not a gnomon-root-decision:v2 row") }
    for r in rows.dropFirst() {
        let sv = r["schemaVersion"] as? String
        guard sv != rootDecisionSchemaV2, sv != rootDecisionSchemaV1 else { throw BatchRefusal(why: "two root decision rows") }
    }
    guard let c = d["cardId"] as? String, let k = d["cardKind"] as? String, let dec = d["decision"] as? String, let h = d["contentHash"] as? String,
          d["approver"] is String, let digest = d["rowsDigest"] as? String else { throw BatchRefusal(why: "the decision row does not name a card, kind, decision, content hash, approver and rows digest") }
    let anchor = ApproveFields(cardId: c, decision: dec, contentHash: h)
    if let a = approve, a != anchor { throw BatchRefusal(why: "the decision row names another card, decision or content hash than the approval") }
    guard sha256Tag(intent) == digest else { throw BatchRefusal(why: "the intent does not hash to the decision row's rowsDigest") }
    guard let shown = (try? JSONSerialization.jsonObject(with: intent)) as? [Any] else { throw BatchRefusal(why: "the intent is not a JSON array") }
    let later = Array(rows.dropFirst())
    guard shown.count == later.count else { throw BatchRefusal(why: "the rows signed are not the rows the card showed (count)") }
    var mh: String?
    for (i, r) in later.enumerated() {
        var bare = r
        for f in volatileFields(r) { bare.removeValue(forKey: f) }
        guard let want = shown[i] as? Json, jsonStrictEqual(bare, want) else { throw BatchRefusal(why: "root row \(i + 1) is not the row the card showed") }
        guard r["cardId"] as? String == c else { throw BatchRefusal(why: "a root row does not name the decided card") }
        if let v = r["manifestHash"] {
            guard let s = v as? String else { throw BatchRefusal(why: "a manifestHash is not a string") }
            if let m = mh, m != s { throw BatchRefusal(why: "two rows name different manifest hashes") }
            mh = s
        }
    }
    if let why = rowTableRefusal(cardKind: k, rows: later) { throw BatchRefusal(why: why) }
    return (anchor, k)
}

/// Validate a decision.sign request before any key is touched: shapes and bounds (`bad-request`), domains
/// (`domain-refused`), then the binding (`batch-refused`).
func decisionBatch(_ req: Json) throws -> DecisionBatch {
    func decode(_ v: Any?, _ key: String, min: Int, max: Int) throws -> [Data] {
        guard let arr = (v ?? [Any]()) as? [Any], arr.count >= min, arr.count <= max else { throw bad("\(key) must be an array of \(min)..\(max) base64 strings") }
        return try arr.map { item in
            guard let s = item as? String, let d = Data(base64Encoded: s), !d.isEmpty, d.count <= Bounds.maxMessageBytes else {
                throw bad("each message must be base64 of 1..\(Bounds.maxMessageBytes) bytes")
            }
            return d
        }
    }
    let approvals = try decode(req["approvals"], "approvals", min: 0, max: Bounds.maxDecisionApprovals)
    let root = try decode(req["root"], "root", min: 1, max: Bounds.maxDecisionRootRows)
    guard approvals.count + root.count <= Bounds.maxDecisionMessages else { throw bad("a decision signs at most \(Bounds.maxDecisionMessages) messages") }
    guard let i = req["intent"] as? String, let intent = Data(base64Encoded: i), !intent.isEmpty, intent.count <= Bounds.maxMessageBytes else { throw bad("intent must be base64 of the card's rootRows JSON") }
    guard (approvals + root).reduce(intent.count, { $0 + $1.count }) <= Bounds.maxDecisionBytes else { throw bad("a decision signs at most \(Bounds.maxDecisionBytes) bytes") }
    var approve: ApproveFields?
    var presences = 0
    for m in approvals {
        if m.starts(with: Data(approveDomain.utf8)) {
            guard approve == nil else { throw bad("at most one approve message per decision") }
            guard let f = parseApprove(m) else { throw bad("the approve message is not a decision preimage") }
            approve = f
        } else if m.starts(with: Data(presenceDomain.utf8)) {
            presences += 1
            guard presences <= 1 else { throw bad("at most one presence message per decision") }
        } else {
            // fresh domains only: never approve-voice:v1, never a row (G-BRK-06, C7)
            throw HelperError("domain-refused", "the approvals key signs only approve:v1 and presence:v1 in a decision")
        }
    }
    var rows: [Json] = []
    for m in root {
        let d = Data(rowDomain.utf8)
        guard m.starts(with: d) else { throw HelperError("domain-refused", "the root key signs only row-sig:v1 rows") }
        guard let obj = (try? JSONSerialization.jsonObject(with: m.subdata(in: d.count..<m.count))) as? Json else { throw bad("each root row must be a JSON object") }
        rows.append(obj)
    }
    do {
        let (anchor, kind) = try bindDecisionBatch(approve: approve, rows: rows, intent: intent)
        return DecisionBatch(approvals: approvals, root: root, rows: rows, anchor: anchor, cardKind: kind)
    } catch let e as BatchRefusal {
        throw HelperError("batch-refused", e.why)
    }
}

/// What one row says on the dialog (Aegis C2), from the bytes signed; nil = a field the dialog cannot show.
func rowShown(_ r: Json, compactCaps: Bool) -> String? {
    func s(_ k: String) -> String? { r[k] as? String }
    switch rowKind(r) {
    case "grant.install":
        guard let n = s("name"), let src = s("source"), let p = s("packageHash") else { return nil }
        return "install \(n) from \(src) \(p.prefix(19))"
    case "grant.trust":
        guard let t = s("tier") else { return nil }
        return "trust \(t)"
    case "grant.capability":
        guard let caps = r["capabilities"] as? [String], !caps.isEmpty else { return nil }
        // Aegis ruling: the full line lists every read path; the compacted line shows only their count
        let reads = (r["read"] as? [String]) ?? []
        if compactCaps { return "\(caps.count) capabilities sha:\(digest12(Data(caps.joined(separator: ",").utf8)))\(reads.isEmpty ? "" : " (reads \(reads.count) paths)")" }
        return "capabilities \(caps.joined(separator: ","))\(reads.isEmpty ? "" : " (reads \(reads.joined(separator: " ")))")"
    case "grant.egress":
        guard let hosts = r["hosts"] as? [String], !hosts.isEmpty else { return nil }
        return "egress \(hosts.joined(separator: " "))"
    case "grant.publisher":
        guard let p = s("publisher"), let h = s("host"), let n = s("namespace") else { return nil }
        return "publisher \(p) → \(h)/\(n)"
    case "grant.uninstall":
        guard let n = s("name") else { return nil }
        return "uninstall \(n)"
    case "voice.enrol":
        guard let sp = s("speakerId") else { return nil }
        return "voice enrol \(sp)"
    case "loop.trusted":
        guard let l = s("loopId"), let sc = s("scope"), let rk = s("repoKey"), let h = s("contentHash") else { return nil }
        return "trust loop \(sc)/\(l) repo \(rk.dropFirst(7).prefix(12)) \(h.prefix(19))"
    case localRootSchema:
        return localRowShown(r)
    case presenceModeSchema:
        guard let m = s("mode") else { return nil }
        return m == "off" ? "Touch ID OFF: every approval becomes a click (root actions keep Touch ID)" : "Touch ID ON"
    case kernelCertKeySchema:
        guard let id = s("certKeyId") else { return nil }
        return "register the kernel-cert key \(id.prefix(19))"
    case kernelLegacySchema:
        guard let ids = r["keyIds"] as? [Any], let log = s("logId"), let seq = jsonWhole(r["headSeq"]), let h = s("headHash") else { return nil }
        return "seal \(ids.count) legacy kernel keys of \(log) at seq \(seq) \(h.prefix(19))"
    default:
        return nil
    }
}

/// The helper's OWN line for a decision (Aegis H3 + C2): the decision, then what EVERY row grants, in full, then
/// every digest it signs (approvals first, then root rows). It goes FIRST in the dialog. Nothing is truncated: a
/// line that does not fit (capabilities may compact to a count + digest) is refused `too-large-to-show`.
func decisionLine(_ b: DecisionBatch) throws -> String {
    let digests = (b.approvals + b.root).map(digest12).joined(separator: " ")
    func build(_ compact: Bool) throws -> String {
        let parts = try b.rows.dropFirst().map { r -> String in
            guard let t = rowShown(r, compactCaps: compact) else { throw HelperError("batch-refused", "a root row cannot be shown on the dialog") }
            return t
        }
        let head = "Gnomon Helper: ONE presence signs \(b.anchor.decision) on \(b.cardKind) \(b.anchor.cardId) \(b.anchor.contentHash.prefix(19))"
        return head + (parts.isEmpty ? "" : "; " + parts.joined(separator: "; ")) + "; digests \(digests)"
    }
    var line = try build(false)
    if line.utf16.count > Bounds.maxDecisionLineChars { line = try build(true) }
    guard line.utf16.count <= Bounds.maxDecisionLineChars else { throw HelperError("batch-refused", "too-large-to-show") }
    guard promptSafe(line) == line else { throw HelperError("batch-refused", "a root row holds a character the dialog cannot show") }
    return line
}

/// The dialog text of a decision: the helper's line FIRST, the kernel's reason after it, capped (Aegis C2).
func decisionPromptText(_ line: String, _ callerReason: String) -> String {
    "\(line)\n\(String(promptSafe(callerReason).prefix(Bounds.maxDecisionReasonChars)))"
}

/// A connId as the prompt shows it: in full up to 48 characters, else a stable short hash (Aegis L4: never a
/// silent truncation that two different ids could share).
func displayConnId(_ c: String) -> String {
    c.count <= 48 ? c : "id#" + digest12(Data(c.utf8))
}

/// A duration as the prompt shows it (Aegis L4: seconds under a minute are never shown as 0 min).
func displayDuration(_ s: Int) -> String {
    if s < 60 { return "\(s) s" }
    return s % 60 == 0 ? "\(s / 60) min" : "\(s / 60) min \(s % 60) s"
}

/// The helper's own line for an ARM prompt (arm.open, §14.7): the pair the arm is bound to and its
/// bounds, computed by the helper from the request it will enforce — the caller cannot hide them.
func armLine(armId: String, humanConnId: String, voiceConnId: String, hardSeconds: Int, maxSignatures: Int) -> String {
    "Gnomon Helper: voice arm \(armId) binds human \(displayConnId(humanConnId)) + voice \(displayConnId(voiceConnId)); "
        + "up to \(displayDuration(hardSeconds)), \(maxSignatures) voice decisions; drops when the screen locks or the Mac sleeps"
}

/// The caller's part of an ARM prompt is capped (Aegis M3), and comes AFTER the helper's own line.
let maxArmReasonChars = 120

/// Aegis M3: for an arm the helper's line goes FIRST, so the binding is what the dialog leads with.
func armPromptText(_ line: String, _ callerReason: String) -> String {
    "\(line)\n\(String(promptSafe(callerReason).prefix(maxArmReasonChars)))"
}

/// The voice decision preimage (gnomon-contracts src/voice-decision.ts, FROZEN with helper 1.6.0; spec §14.7,
/// A26-04): after the domain line, exactly 15 lines — the marker, then cardId, decision, cardContentHash,
/// approverPrincipalId, armId, humanConnId, voiceConnId, turnId, utteranceHash, handleHash, challengeHash,
/// readbackHash, confirmHash, answerDigest. nil when the message is not exactly that layout.
struct VoiceDecision {
    let armId: String
    let humanConnId: String
    let voiceConnId: String
}

/// The same rules as gnomon-contracts parseVoiceDecisionMessage (shared vectors: gnomon-contracts
/// test/fixtures/voice-decision-vectors.json): split the BYTES on 0x0A; each field valid UTF-8, non-empty, ≤ 256
/// UTF-16 code units (JS length), no C0 control (so no CR) and no DEL; `-` only in lines 10–14.
func parseVoiceDecisionBody(_ body: Data) -> VoiceDecision? {
    let lines = body.split(separator: 0x0A, omittingEmptySubsequences: false)
    guard lines.count == 15 else { return nil }
    var f: [String] = []
    for raw in lines {
        guard !raw.isEmpty, !raw.contains(where: { $0 < 0x20 || $0 == 0x7F }),
              let s = String(data: Data(raw), encoding: .utf8), s.utf16.count <= 256 else { return nil }
        f.append(s)
    }
    guard f[0] == "gnomon:voice-decision:v1" else { return nil }
    func isHash(_ s: String) -> Bool {
        s.utf8.count == 71 && s.hasPrefix("sha256:") && s.utf8.dropFirst(7).allSatisfy { (0x30...0x39).contains($0) || (0x61...0x66).contains($0) }
    }
    for (i, v) in f.enumerated().dropFirst() {
        switch i {
        case 3, 9: guard isHash(v) else { return nil }                  // cardContentHash, utteranceHash
        case 10...14: guard v == "-" || isHash(v) else { return nil }   // handle, challenge, readback, confirm, answer
        default: guard v != "-" else { return nil }                     // absent is allowed nowhere else
        }
    }
    return VoiceDecision(armId: f[5], humanConnId: f[6], voiceConnId: f[7])
}

func parseVoiceDecision(_ m: Data) -> VoiceDecision? {
    let domain = Data("gnomon:approve-voice:v1\n".utf8)
    guard m.starts(with: domain) else { return nil }
    return parseVoiceDecisionBody(m.subdata(in: domain.count..<m.count))
}

/// T-2026-10-18-028 M4 (defence in depth; the kernel strips them first, card.ts promptSafe): no format
/// character (Cf: bidi controls and marks, invisible operators) and no control but the one newline
/// the helper adds itself reaches the OS prompt, whatever the caller sends.
func promptSafe(_ s: String) -> String {
    String(String.UnicodeScalarView(s.unicodeScalars.filter { u in
        switch u.properties.generalCategory {
        case .format, .control, .lineSeparator, .paragraphSeparator: return false
        default: return true
        }
    }))
}

func promptText(_ callerReason: String, _ line: String) -> String {
    "\(promptSafe(callerReason))\n\(line)"
}

/// One serialized writer for stdout: replies (the request thread) and pushes (the session observer on
/// the main thread) never interleave inside a line. Tests inject `sink`.
final class Output {
    private let lock = NSLock()
    private let sink: (Data) -> Void

    init(sink: @escaping (Data) -> Void = { FileHandle.standardOutput.write($0) }) {
        self.sink = sink
    }

    func emit(_ line: Data) {
        lock.lock()
        defer { lock.unlock() }
        sink(line)
    }
}
