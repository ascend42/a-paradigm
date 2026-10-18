// gnomon-helper (darwin) — the wire protocol `gnomon-helper:v1` (spec §3.1
// root + approvals keys, §16 keys row; M1.3 slice 1).
//
// NDJSON over stdin/stdout: one JSON object per line in, one per line out.
//   request  {"id": <int|string>, "op": "<op>", ...params}
//   reply    {"id": <same>, "ok": true, ...result} | {"id": ..., "ok": false, "error": "<code>", "message"?: "...", "status"?: <OSStatus>}
//
// Output NEVER carries private key material (a Secure Enclave key cannot be
// exported anyway): only public keys (X9.63, base64), DER signatures and
// error codes. Every input is bounded and validated here, before any key is
// touched; a bad request is refused with `bad-request`.

import Foundation

let helperProtocol = "gnomon-helper:v1"

/// Bounds (attacker-growable inputs are capped before use).
enum Bounds {
    static let maxLineBytes = 1 << 20          // one request line
    static let maxMessages = 4                 // per sign request
    static let maxMessageBytes = 65_536        // per message, decoded
    static let maxReasonChars = 512            // the presence prompt text
    static let maxConnIdChars = 128
    static let maxUnlocks = 32                 // per-connection unlocks held at once
    static let unlockIdleSeconds: TimeInterval = 15 * 60
}

/// The key classes the helper holds (§3.1). Each may sign only preimages that
/// start with one of its domains — the kernel prepends the domain, the helper
/// re-checks it, so a request can never make the approvals key sign a row or
/// the root key sign a decision.
enum KeyClass: String {
    case root
    case approvals

    var allowedDomains: [String] {
        switch self {
        case .root: return ["gnomon:row-sig:v1\n", "gnomon:presence:v1\n"]
        case .approvals: return ["gnomon:approve:v1\n", "gnomon:presence:v1\n"]
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

func connId(_ req: Json) throws -> String? {
    guard let c = try optStr(req, "connId") else { return nil }
    let ok = !c.isEmpty && c.count <= Bounds.maxConnIdChars && c.unicodeScalars.allSatisfy {
        ("a"..."z").contains($0) || ("A"..."Z").contains($0) || ("0"..."9").contains($0) || $0 == ":" || $0 == "-" || $0 == "_"
    }
    guard ok else { throw bad("connId must match [A-Za-z0-9:_-]{1,128}") }
    return c
}

/// The messages to sign: 1..4 base64 strings, each ≤ 64 KiB decoded, each starting with a domain of `key`.
func messages(_ req: Json, for key: KeyClass) throws -> [Data] {
    guard let arr = req["messages"] as? [Any], !arr.isEmpty, arr.count <= Bounds.maxMessages else {
        throw bad("messages must be an array of 1..\(Bounds.maxMessages) base64 strings")
    }
    return try arr.map { item in
        guard let s = item as? String, let d = Data(base64Encoded: s), !d.isEmpty, d.count <= Bounds.maxMessageBytes else {
            throw bad("each message must be base64 of 1..\(Bounds.maxMessageBytes) bytes")
        }
        guard key.allowedDomains.contains(where: { d.starts(with: Data($0.utf8)) }) else {
            throw HelperError("domain-refused", "the \(key.rawValue) key does not sign this domain")
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
