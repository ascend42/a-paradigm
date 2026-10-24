// gnomon-helper (darwin) — custody of every evaluated LAContext the helper
// holds (helper 1.6.0; spec §14.7 Arms, S29-K5 unlock custody, S26-C3 /
// A26-01 / A26-03 arm, G-BRK-06 signature domains, §A.1, §A.4).
//
//   Unlocks  per-connId cached unlocks (Keys.swift): `gnomon:approve:v1` only.
//   Arms     per-armId voice arms, a SEPARATE store with its OWN caps
//            (Bounds.maxArms, never Bounds.maxUnlocks): an arm is opened by a
//            fresh-presence evaluation bound to {humanConnId, voiceConnId} and
//            signs `gnomon:approve-voice:v1` only, for exactly that pair.
//   Custody  one lock over both stores, plus an EPOCH that every session event
//            (lock, screensaver, display sleep, system sleep, user switch)
//            bumps: a presence prompt that was up while the session ended can
//            never be kept as an unlock or an arm afterwards.
//
// Threads (serve): requests run on the reader thread, session events on the
// main run loop (SessionWatch.swift). Every read or write of either store goes
// through Custody.sync; a cached or arm signature is made INSIDE the lock, so
// an invalidation is ordered strictly before or strictly after it.

import Foundation
import LocalAuthentication

/// Per-armId voice arms (bounded by Bounds.maxArms; hard- and optionally idle-expiring; signature-capped).
final class Arms {
    struct Entry {
        let gen: String
        let humanConnId: String
        let voiceConnId: String
        let ctx: LAContext
        let opened: Date
        var lastUsed: Date
        /// nil: no idle bound (a gate arm is never refreshed on activity, §14.7; only its hard bound ends it)
        let idleSeconds: TimeInterval?
        let hardSeconds: TimeInterval
        let maxSignatures: Int
        var signatures: Int
    }

    enum Put: Equatable {
        case ok
        case exists // a live arm already has this id (an arm is never re-opened, §14.7)
        case full   // Bounds.maxArms
    }

    private var byArm: [String: Entry] = [:]
    private let now: () -> Date

    init(now: @escaping () -> Date = Date.init) {
        self.now = now
    }

    var count: Int {
        sweep()
        return byArm.count
    }

    var ids: [String] { byArm.keys.sorted() }

    func has(_ armId: String) -> Bool {
        sweep()
        return byArm[armId] != nil
    }

    /// Room for one more arm (checked BEFORE a presence prompt, so nobody touches for an arm that cannot be kept).
    func canOpen(_ armId: String) -> Put {
        sweep()
        if byArm[armId] != nil { return .exists }
        if byArm.count >= Bounds.maxArms { return .full }
        return .ok
    }

    func put(_ armId: String, gen: String, humanConnId: String, voiceConnId: String, ctx: LAContext,
             hardSeconds: TimeInterval, idleSeconds: TimeInterval?, maxSignatures: Int) -> Put {
        let room = canOpen(armId)
        guard room == .ok else { return room }
        let t = now()
        byArm[armId] = Entry(gen: gen, humanConnId: humanConnId, voiceConnId: voiceConnId, ctx: ctx, opened: t, lastUsed: t,
                             idleSeconds: idleSeconds, hardSeconds: hardSeconds, maxSignatures: maxSignatures, signatures: 0)
        return .ok
    }

    /// Spend `n` signatures of THIS arm, for THIS pair and generation. nil = no such live arm, another
    /// pair or generation, or the cap would be passed (then the arm is closed: its count is spent).
    func use(_ armId: String, gen: String, humanConnId: String, voiceConnId: String, signatures n: Int) -> LAContext? {
        sweep()
        guard var e = byArm[armId], e.gen == gen, e.humanConnId == humanConnId, e.voiceConnId == voiceConnId else { return nil }
        guard n > 0, e.signatures + n <= e.maxSignatures else {
            close(armId)
            return nil
        }
        e.signatures += n
        e.lastUsed = now()
        byArm[armId] = e
        return e.ctx
    }

    @discardableResult
    func close(_ armId: String) -> Bool {
        guard let e = byArm.removeValue(forKey: armId) else { return false }
        e.ctx.invalidate()
        return true
    }

    /// Close every arm; returns the ids closed (sorted).
    @discardableResult
    func closeAll() -> [String] {
        let ids = byArm.keys.sorted()
        for e in byArm.values { e.ctx.invalidate() }
        byArm.removeAll()
        return ids
    }

    /// A connection closed: every arm that names it, as the human or the voice side, ends (§14.7 "either connection closing").
    @discardableResult
    func closeReferencing(_ connId: String) -> [String] {
        let ids = byArm.filter { $0.value.humanConnId == connId || $0.value.voiceConnId == connId }.keys.sorted()
        for id in ids { close(id) }
        return ids
    }

    private func sweep() {
        let t = now()
        for (id, e) in byArm where t.timeIntervalSince(e.opened) > e.hardSeconds
            || (e.idleSeconds.map { t.timeIntervalSince(e.lastUsed) > $0 } ?? false)
            || e.signatures >= e.maxSignatures {
            e.ctx.invalidate()
            byArm.removeValue(forKey: id)
        }
    }
}

/// Both stores behind one lock, plus the session epoch.
final class Custody {
    let unlocks: Unlocks
    let arms: Arms
    private let lock = NSLock()
    private var epochValue: UInt64 = 0

    init(unlocks: Unlocks = Unlocks(), arms: Arms = Arms()) {
        self.unlocks = unlocks
        self.arms = arms
    }

    /// Run `body` with exclusive access to both stores. Never nest.
    func sync<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    /// Read under the lock (callers outside sync).
    var epoch: UInt64 { sync { epochValue } }

    /// Inside sync only: the epoch a prompt started in is still current (no session event since).
    func epochIsCurrent(_ e: UInt64) -> Bool { epochValue == e }

    /// A session event (or the end of the process): invalidate EVERY arm and EVERY cached unlock, and bump
    /// the epoch so a prompt that is up right now can never be kept. Returns what was closed.
    @discardableResult
    func invalidateAll() -> (arms: [String], unlocks: Int) {
        sync {
            epochValue &+= 1
            return (arms: arms.closeAll(), unlocks: unlocks.dropAll())
        }
    }
}
