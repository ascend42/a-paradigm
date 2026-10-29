// gnomon-helper (darwin) 1.11.0 — the log anchor `gnomon-head` (TD-2026-10-29-746, G-HLP-03): the kernel's log head
// {logId, seq, hash} in a keychain item only this helper writes (Items.swift). No presence; at most 10 writes a second.
// The kernel writes it as the log grows and reads it at start: a log on disk BEHIND the anchor (a truncated or
// rolled-back log), or a different hash at the anchored seq (a rewritten one), is detected (anchorVerdict).
//   anchor.write {logId, seq, hash, newLog?}  refuses a lower seq (anchor-rollback), another hash at the same seq
//                                            (anchor-fork) and another logId unless newLog (anchor-log)
//   anchor.read  {seq?, hash?}               → {head | empty, verdict?}: the verdict for the kernel's own head

import Foundation

let anchorAccount = "gnomon-head"
let anchorWritesPerSecond = 10

struct AnchorHead: Equatable {
    let logId: String
    let seq: Int64
    let hash: String
}

func anchorHead(_ req: Json) throws -> AnchorHead {
    guard let log = req["logId"] as? String, fullMatch(log, "^log:[0-9A-HJKMNP-TV-Z]{26}$") else { throw bad("logId is log:<ULID>") }
    guard let n = req["seq"] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue == n.doubleValue.rounded(), n.int64Value >= 0, n.int64Value <= 9_007_199_254_740_991 else { throw bad("seq is a whole number") }
    guard let h = req["hash"] as? String, fullMatch(h, "^sha256:[0-9a-f]{64}$") else { throw bad("hash is sha256:<64 hex>") }
    return AnchorHead(logId: log, seq: n.int64Value, hash: h)
}

/// What the kernel's own head says against the anchor: ok (equal), ahead (the log grew past it, the normal case
/// between writes), rollback (the log is behind it), fork (same seq, another hash), other-log, empty (no anchor yet).
func anchorVerdict(stored: AnchorHead?, log: AnchorHead) -> String {
    guard let s = stored else { return "empty" }
    guard s.logId == log.logId else { return "other-log" }
    if log.seq < s.seq { return "rollback" }
    if log.seq == s.seq { return log.hash == s.hash ? "ok" : "fork" }
    return "ahead"
}

final class Anchor {
    let items: ItemStore
    let clock: () -> Date
    private var window = RateWindow(limit: anchorWritesPerSecond, seconds: 1)
    private let lock = NSLock()

    init(items: ItemStore, clock: @escaping () -> Date = Date.init) {
        self.items = items
        self.clock = clock
    }

    func stored() throws -> AnchorHead? {
        guard let d = try items.read(anchorAccount) else { return nil }
        guard let o = (try? JSONSerialization.jsonObject(with: d)) as? Json, let h = try? anchorHead(o) else { throw HelperError("anchor-unreadable", "the anchor item is malformed") }
        return h
    }

    func read(_ req: Json) throws -> Json {
        lock.lock()
        defer { lock.unlock() }
        let s = try stored()
        var out: Json = s.map { ["logId": $0.logId, "seq": $0.seq, "hash": $0.hash, "empty": false] } ?? ["empty": true]
        if req["seq"] != nil || req["hash"] != nil || req["logId"] != nil { out["verdict"] = anchorVerdict(stored: s, log: try anchorHead(req)) }
        return out
    }

    func write(_ req: Json) throws -> Json {
        let h = try anchorHead(req)
        let newLog = try optBool(req, "newLog")
        lock.lock()
        defer { lock.unlock() }
        guard window.take(clock()) else { throw HelperError("rate-limited", "at most \(anchorWritesPerSecond) anchor writes a second") }
        if let s = try stored() {
            if s.logId != h.logId {
                guard newLog else { throw HelperError("anchor-log", "the anchor names another log; a new log needs newLog") }
            } else if h.seq < s.seq {
                throw HelperError("anchor-rollback", "the anchor is at seq \(s.seq); seq \(h.seq) would roll it back")
            } else if h.seq == s.seq {
                guard h.hash == s.hash else { throw HelperError("anchor-fork", "another hash at the anchored seq \(s.seq)") }
                return ["written": false, "seq": s.seq]
            }
        }
        try items.write(anchorAccount, canonicalJSON(["logId": h.logId, "seq": h.seq, "hash": h.hash] as Json))
        return ["written": true, "seq": h.seq]
    }
}
