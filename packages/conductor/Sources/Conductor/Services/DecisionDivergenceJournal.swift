// DecisionDivergenceJournal.swift — #decision-divergence-journal
// Append-only JSONL LEARNING INSTRUMENT for the cockpit's $decision-exchange.
//
// WHY (Loid's instrument design, L-2026-06-17-ascend-181541-001): the cockpit's
// answerDecision settles the human's pick and replays it as a plain user turn with
// ZERO path back to any learning loop. This journal closes that SEALED loop by
// emitting a FALSIFIABLE signal: when the human GROUNDS a decision (its `symbols`
// are non-empty) and DIVERGES from the agent's recommendation, that divergence is
// the thing worth compounding. Agreements are written too (diverged:false) so the
// divergence RATE is computable; UNGROUNDED decisions write NOTHING (the gate that
// keeps the loop honest, not noisy). A reopen-after-settle is the stale-graph
// watchdog — a separate event row.
//
// INSTRUMENT-FIRST: this writer is the producer only. The journal-promotion
// CONSUMER (reading these rows into agent notebooks via the gate) is a DEFERRED
// follow-up — exactly how the framework shipped promotion-decisions.jsonl before
// wiring belief-delta promotion.
//
// File layout (cockpit's OWN write-domain — NOT framework-owned .paradigm/events/):
//   ~/.paradigm/conductor/decisions/<sessionId>.jsonl   (per session)
//
// Row schema (one JSON object per line):
//   { "ts": <iso8601>, "sessionId": <string>, "decisionId": <string>,
//     "symbols": [<string>], "grounded": true, "recommendedOptionId": <string?>,
//     "chosenOptionIds": [<string>], "otherText": <string?>,
//     "diverged": <bool>, "event": "answer" | "reopen" }
//
// Concurrency contract (mirrors #session-transcript, Swift 6 safe):
//   - All file writes run on a PRIVATE serial DispatchQueue so the main actor and
//     the decision UI are NEVER blocked by disk I/O.
//   - `final class` marked `@unchecked Sendable`: its only mutable state (the file
//     handle / failed flag) is touched solely inside the serial queue.
//   - Every write is best-effort: a failed write is swallowed (never blocks the
//     decision UI). A single ConductorLog line marks first failure.

import Foundation

/// Append-only JSONL divergence journal for one cockpit session's decisions.
/// Construct ONE per session (lazily on first grounded decision); call
/// `recordAnswer` / `recordReopen` at the settle/reopen boundaries.
final class DecisionDivergenceJournal: @unchecked Sendable {

    /// Serial queue — ALL disk I/O happens here so callers never block.
    private let queue: DispatchQueue

    /// Absolute path to this session's divergence journal file.
    let fileURL: URL

    /// The open file handle (lazily opened on first write). Touched only on `queue`.
    private var handle: FileHandle?

    /// Set once if any write has failed, so we log the failure exactly once and
    /// then stay silent (never spam, never block the UI). Touched only on `queue`.
    private var failed = false

    // MARK: - Init

    /// Build a journal for a cockpit session id. Computes the file path immediately;
    /// does NOT touch disk until the first write.
    init(sessionId: String) {
        let safe = Self.sanitize(sessionId)
        let dir = Self.decisionsDirectory()
        self.fileURL = dir.appendingPathComponent("\(safe).jsonl")
        let label = String(safe.suffix(12))
        self.queue = DispatchQueue(label: "com.a-company.paradigm.conductor.decisions.\(label)")
    }

    // MARK: - Pure, unit-testable divergence rule (Loid's gate)

    /// Did the human DIVERGE from the agent's recommendation?
    ///
    /// diverged = the human used "Other"/free-text, OR (a recommended option exists
    /// AND the chosen set != the single recommended id). No recommendation → false
    /// (unless other was used). Pure/deterministic so a focused unit test can assert
    /// every branch.
    static func decisionDiverged(recommendedId: String?, chosenIds: [String], usedOther: Bool) -> Bool {
        if usedOther { return true }
        guard let recommendedId else { return false }
        // For single- and multi-select alike: divergence iff the chosen SET is not
        // exactly the single recommended id.
        return Set(chosenIds) != [recommendedId]
    }

    // MARK: - Public recording API (settle / reopen boundaries)

    /// Append an `event:"answer"` row for a GROUNDED decision (symbols non-empty).
    /// Computes `diverged` via the pure rule. Best-effort + off the main actor.
    /// Callers MUST gate on non-empty symbols before calling (ungrounded → nothing).
    func recordAnswer(
        sessionId: String,
        decisionId: String,
        symbols: [String],
        recommendedOptionId: String?,
        chosenOptionIds: [String],
        otherText: String?,
        diverged: Bool
    ) {
        appendRow(
            event: "answer",
            sessionId: sessionId,
            decisionId: decisionId,
            symbols: symbols,
            recommendedOptionId: recommendedOptionId,
            chosenOptionIds: chosenOptionIds,
            otherText: otherText,
            diverged: diverged
        )
    }

    /// Append an `event:"reopen"` row — the stale-graph watchdog. A previously
    /// settled GROUNDED decision was reopened/changed. Carries the last-known answer
    /// so the consumer can see what was unsettled. Best-effort + off the main actor.
    func recordReopen(
        sessionId: String,
        decisionId: String,
        symbols: [String],
        recommendedOptionId: String?,
        chosenOptionIds: [String],
        otherText: String?,
        diverged: Bool
    ) {
        appendRow(
            event: "reopen",
            sessionId: sessionId,
            decisionId: decisionId,
            symbols: symbols,
            recommendedOptionId: recommendedOptionId,
            chosenOptionIds: chosenOptionIds,
            otherText: otherText,
            diverged: diverged
        )
    }

    // MARK: - Core write (serial, best-effort, non-blocking)

    private func appendRow(
        event: String,
        sessionId: String,
        decisionId: String,
        symbols: [String],
        recommendedOptionId: String?,
        chosenOptionIds: [String],
        otherText: String?,
        diverged: Bool
    ) {
        let ts = Self.isoNow()
        queue.async { [weak self] in
            guard let self, !self.failed else { return }
            var fields: [String: JSONEncodableValue] = [
                "ts": .string(ts),
                "sessionId": .string(sessionId),
                "decisionId": .string(decisionId),
                "symbols": .stringArray(symbols),
                "grounded": .bool(true),
                "chosenOptionIds": .stringArray(chosenOptionIds),
                "diverged": .bool(diverged),
                "event": .string(event),
            ]
            fields["recommendedOptionId"] = recommendedOptionId.map { .string($0) } ?? .null
            fields["otherText"] = (otherText?.isEmpty == false) ? .string(otherText!) : .null
            guard let line = SessionTranscript.encodeLine(fields) else { return }
            self.appendLine(line)
        }
    }

    /// Append one already-serialized line to the per-session journal. Reuses the
    /// session handle (opened on first write). MUST run on `queue`.
    private func appendLine(_ line: String) {
        let data = Data((line + "\n").utf8)
        if handle == nil { handle = openForAppend(fileURL) }
        guard let h = handle else { markFailed(); return }
        do {
            try h.write(contentsOf: data)
            // Best-effort flush so an inspector reading mid-session sees it.
            try? h.synchronize()
        } catch {
            markFailed()
        }
    }

    /// Open (creating the dir + file if needed) a FileHandle positioned at EOF.
    private func openForAppend(_ url: URL) -> FileHandle? {
        let fm = FileManager.default
        let dir = url.deletingLastPathComponent()
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        if !fm.fileExists(atPath: url.path) {
            fm.createFile(atPath: url.path, contents: nil)
        }
        guard let h = try? FileHandle(forWritingTo: url) else { return nil }
        _ = try? h.seekToEnd()
        return h
    }

    /// Record (once) that a write failed, so the loop isn't silently broken AND we
    /// don't spam. After this, all writes are no-ops. Never blocks the decision UI.
    private func markFailed() {
        guard !failed else { return }
        failed = true
        let path = fileURL.path
        ConductorLog.component("decision-divergence-journal")
            .error("divergence-journal write failed for \(path); disabling for this session")
    }

    // MARK: - Paths & timestamps

    /// `~/.paradigm/conductor/decisions` — sibling of the atrium transcript dir, in
    /// the cockpit's OWN write-domain (NOT framework-owned .paradigm/events/).
    static func decisionsDirectory() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".paradigm", isDirectory: true)
            .appendingPathComponent("conductor", isDirectory: true)
            .appendingPathComponent("decisions", isDirectory: true)
    }

    /// Make a session id filesystem-safe (drop path separators / spaces). Empty →
    /// "unknown-session" so a row never lands on a bare ".jsonl".
    static func sanitize(_ sessionId: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        let scrubbed = String(sessionId.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" })
        let trimmed = scrubbed.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return trimmed.isEmpty ? "unknown-session" : trimmed
    }

    /// ISO8601 timestamp for rows.
    static func isoNow() -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime]
        return fmt.string(from: Date())
    }
}
