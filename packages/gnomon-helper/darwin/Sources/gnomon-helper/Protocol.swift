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
let gnomonHelperVersion = "1.6.0"
let helperProtocol = "gnomon-helper:v2"

/// Bounds (attacker-growable inputs are capped before use).
enum Bounds {
    static let maxLineBytes = 1 << 20          // one request line
    static let maxMessages = 4                 // per sign request
    static let maxMessageBytes = 65_536        // per message, decoded
    static let maxReasonChars = 512            // the caller's part of the presence prompt (the helper appends its own line)
    static let maxConnIdChars = 128
    static let maxUnlocks = 32                 // per-connection unlocks held at once
    static let unlockIdleSeconds: TimeInterval = 15 * 60
    // T-2026-10-18-028 M2: the idle timer slides on every use, so two HARD bounds end an unlock too,
    // whatever the kernel says (the broker enforces the same pair on its side, broker/unlock.ts):
    static let unlockAbsoluteSeconds: TimeInterval = 60 * 60   // from the presence that opened it
    static let maxSignaturesPerUnlock = 64                      // signatures made under it
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

/// The helper's own line for an ARM prompt (arm.open, §14.7): the pair the arm is bound to and its
/// bounds, computed by the helper from the request it will enforce — the caller cannot hide them.
func armLine(armId: String, humanConnId: String, voiceConnId: String, hardSeconds: Int, maxSignatures: Int) -> String {
    "Gnomon Helper: voice arm \(armId) binds human \(humanConnId.prefix(48)) + voice \(voiceConnId.prefix(48)); "
        + "up to \(hardSeconds / 60) min, \(maxSignatures) voice decisions; drops when the screen locks or the Mac sleeps"
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
