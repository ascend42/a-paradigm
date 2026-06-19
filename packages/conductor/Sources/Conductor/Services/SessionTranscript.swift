// SessionTranscript.swift — #session-transcript
// Append-only JSONL transcript of a single ATRIUM `claude` stream session.
//
// GOAL (founder directive): every ATRIUM session's full stream I/O is persisted
// to an INSPECTABLE file under ~/.paradigm so an external inspector (Claude /
// tooling) can `Read` it and diagnose runtime behavior WITHOUT screenshots or
// Console. Satisfies the standing substrate constraint: session signals land in
// ~/.paradigm/, not trapped inside the app.
//
// File layout:
//   ~/.paradigm/conductor/atrium/atrium-<startup-ts>-<short-uuid>.jsonl   (per session)
//   ~/.paradigm/conductor/atrium/index.jsonl                              (discovery index)
//
// One JSON object per line. Schema (every line has ts + dir + kind):
//   { "ts": <epoch-ms>, "dir": "meta"|"in"|"out", "kind": "<...>", ... }
//
// Concurrency contract (Swift 6 safe):
//   - All file writes run on a PRIVATE serial DispatchQueue, so the main actor
//     and the off-main stream decode are NEVER blocked by disk I/O.
//   - The type is a `final class` marked `@unchecked Sendable`: its only mutable
//     state (the file handle) is touched solely inside the serial queue, which
//     serializes all access. The immutable config (paths/ids) is set at init.
//   - Every write is best-effort: a failed write is swallowed (never crashes the
//     session over logging). A single ConductorLog line marks first failure.

import Foundation

/// Append-only JSONL transcript writer for one ATRIUM claude session.
/// Construct ONE per session (in `start()`); call `log*` at the I/O boundaries.
final class SessionTranscript: @unchecked Sendable {

    /// Stable startup id assigned before spawn (the real claude session_id only
    /// arrives later in system/init). Used in the filename + every index row.
    let startupId: String

    /// Absolute path to this session's transcript file.
    let fileURL: URL

    /// Absolute path to the shared discovery index.
    private let indexURL: URL

    /// Serial queue — ALL disk I/O happens here so callers never block.
    private let queue: DispatchQueue

    /// The open file handle (lazily opened on first write). Touched only on `queue`.
    private var handle: FileHandle?

    /// Set once if any write has failed, so we log the failure exactly once and
    /// then stay silent (never spam, never crash).
    private var failed = false

    /// The last session_id we wrote a `session_id` meta + "linked" index row for.
    /// Claude Code emits a `system` line (carrying the session_id) on every turn,
    /// so without this guard we'd write a duplicate meta + index row per result.
    /// We write the pair ONCE — on first observation and again only if the id
    /// actually changes (#session-transcript). Touched only on `queue`.
    private var lastLoggedSessionId: String?

    // MARK: - Init

    /// Build a transcript for a session. Computes the file path immediately from a
    /// startup timestamp + short uuid; does NOT touch disk until the first write.
    init() {
        let now = Date()
        let stamp = Self.fileTimestamp(now)
        let shortUUID = String(UUID().uuidString.prefix(8)).lowercased()
        let id = "atrium-\(stamp)-\(shortUUID)"
        self.startupId = id

        let dir = Self.atriumDirectory()
        self.fileURL = dir.appendingPathComponent("\(id).jsonl")
        self.indexURL = dir.appendingPathComponent("index.jsonl")
        self.queue = DispatchQueue(label: "com.a-company.paradigm.conductor.transcript.\(shortUUID)")
    }

    // MARK: - Public logging API (boundary calls)

    /// Session start meta line + an index row. Call once in `start()` after spawn.
    func logSessionStart(projectPath: String, claudePath: String, resolvedPATH: String, pid: Int32) {
        let pathSnippet = String(resolvedPATH.prefix(200))
        write([
            "dir": "meta",
            "kind": "session_start",
            "projectPath": .string(projectPath),
            "claudePath": .string(claudePath),
            "resolvedPATH": .string(pathSnippet),
            "pid": .int32(pid),
            "startupId": .string(startupId),
        ])
        appendIndex([
            "startupId": .string(startupId),
            "file": .string(fileURL.lastPathComponent),
            "projectPath": .string(projectPath),
            "started": .string(isoNow()),
            "pid": .int32(pid),
        ])
    }

    /// The real claude session_id (and model) arriving in system/init. Records a
    /// meta line in the file AND an index row so an inspector can map id↔file.
    ///
    /// IDEMPOTENT (#session-transcript FIX 4): Claude Code re-emits a `system` line
    /// carrying the session_id on every turn/result. We dedup on the serial queue
    /// and write the meta + "linked" index row ONLY when the id is first seen or
    /// actually changes — never once per result. Lightweight: a single string
    /// compare guards the pair.
    func logSessionId(sessionId: String, model: String?) {
        queue.async { [weak self] in
            guard let self, !self.failed else { return }
            guard self.lastLoggedSessionId != sessionId else { return }
            self.lastLoggedSessionId = sessionId
            self.writeLocked([
                "dir": "meta",
                "kind": "session_id",
                "sessionId": .string(sessionId),
                "model": .string(model ?? ""),
            ])
            self.appendIndexLocked([
                "startupId": .string(self.startupId),
                "file": .string(self.fileURL.lastPathComponent),
                "sessionId": .string(sessionId),
                "model": .string(model ?? ""),
                "linked": .string(self.isoNow()),
            ])
        }
    }

    // MARK: in — host → claude

    func logUserTurn(text: String, isControl: Bool) {
        write([
            "dir": "in",
            "kind": "user_turn",
            "text": .string(truncate(text)),
            "isControl": .bool(isControl),
        ])
    }

    func logInterrupt(requestId: String) {
        write([
            "dir": "in",
            "kind": "interrupt",
            "requestId": .string(requestId),
        ])
    }

    func logKill(shellId: String) {
        write([
            "dir": "in",
            "kind": "kill",
            "shellId": .string(shellId),
        ])
    }

    // MARK: out — claude → host

    func logAssistantText(_ text: String) {
        write([
            "dir": "out",
            "kind": "assistant_text",
            "text": .string(truncate(text)),
        ])
    }

    func logToolUse(name: String, inputSummary: String) {
        write([
            "dir": "out",
            "kind": "tool_use",
            "name": .string(name),
            "input": .string(truncate(inputSummary, limit: 1024)),
        ])
    }

    func logToolResult(toolUseId: String, content: String, isError: Bool) {
        write([
            "dir": "out",
            "kind": "tool_result",
            "toolUseId": .string(toolUseId),
            "isError": .bool(isError),
            "content": .string(truncate(content)),
        ])
    }

    func logResult(subtype: String?, totalCostUsd: Double?, usage: Usage?) {
        var entry: [String: JSONEncodableValue] = [
            "dir": "out",
            "kind": "result",
            "subtype": .string(subtype ?? ""),
        ]
        if let totalCostUsd { entry["totalCostUsd"] = .double(totalCostUsd) }
        if let usage {
            entry["inputTokens"] = .intOpt(usage.inputTokens)
            entry["outputTokens"] = .intOpt(usage.outputTokens)
            entry["cacheReadInputTokens"] = .intOpt(usage.cacheReadInputTokens)
            entry["cacheCreationInputTokens"] = .intOpt(usage.cacheCreationInputTokens)
        }
        write(entry)
    }

    func logControlResponse(subtype: String?, requestId: String?) {
        write([
            "dir": "out",
            "kind": "control_response",
            "subtype": .string(subtype ?? ""),
            "requestId": .string(requestId ?? ""),
        ])
    }

    /// Log a system task lifecycle event. EXTENDED (#sub-agent) to capture the
    /// fields that the earlier LOSSY logging dropped — tool_use_id + task_type (the
    /// deterministic correlation + typing signals) and the usage block
    /// (total_tokens / tool_uses / duration_ms) — so future debugging isn't blind to
    /// what the wire actually carries. Optional usage fields are omitted when absent.
    func logSystemTask(
        subtype: String,
        taskId: String?,
        status: String?,
        toolUseId: String? = nil,
        taskType: String? = nil,
        totalTokens: Int? = nil,
        toolUses: Int? = nil,
        durationMs: Int? = nil
    ) {
        var entry: [String: JSONEncodableValue] = [
            "dir": "out",
            "kind": "system_task",
            "subtype": .string(subtype),
            "taskId": .string(taskId ?? ""),
            "status": .string(status ?? ""),
            "toolUseId": .string(toolUseId ?? ""),
            "taskType": .string(taskType ?? ""),
        ]
        if let totalTokens { entry["totalTokens"] = .int(totalTokens) }
        if let toolUses { entry["toolUses"] = .int(toolUses) }
        if let durationMs { entry["durationMs"] = .int(durationMs) }
        write(entry)
    }

    func logUnknown(rawType: String) {
        write([
            "dir": "out",
            "kind": "unknown",
            "rawType": .string(rawType),
        ])
    }

    func logStderr(_ line: String) {
        write([
            "dir": "out",
            "kind": "stderr",
            "line": .string(truncate(line)),
        ])
    }

    func logDecodeFailure(_ detail: String) {
        write([
            "dir": "out",
            "kind": "decode_failure",
            "detail": .string(truncate(detail)),
        ])
    }

    // MARK: meta — lifecycle end

    func logSessionEnd(reason: String, exitCode: Int32?) {
        var entry: [String: JSONEncodableValue] = [
            "dir": "meta",
            "kind": "session_end",
            "reason": .string(reason),
        ]
        if let exitCode { entry["exitCode"] = .int(Int(exitCode)) }
        write(entry)
    }

    // MARK: - Core write (serial, best-effort, non-blocking)

    /// Convenience overload taking a string-keyed dictionary of mixed scalars.
    /// Bridges `Bool`/`Int`/`Int32`/`String`/`Double` literals to the encodable
    /// value enum so the call sites stay terse.
    private func write(_ fields: [String: JSONEncodableValue]) {
        let ts = Date().timeIntervalSince1970
        let tsMillis = Int((ts * 1000).rounded())
        // Build the line off the caller's thread? No — keep it cheap here and do
        // the encoding on the serial queue so the main actor returns instantly.
        queue.async { [weak self] in
            guard let self else { return }
            self.writeLocked(fields, tsMillis: tsMillis)
        }
    }

    /// MUST already be running on `queue`. Encodes + appends one line. Lets a
    /// caller that is itself on the queue (e.g. the deduped logSessionId) write
    /// without a second async hop that would reorder lines.
    private func writeLocked(_ fields: [String: JSONEncodableValue], tsMillis: Int? = nil) {
        guard !failed else { return }
        var obj = fields
        obj["ts"] = .int(tsMillis ?? Int((Date().timeIntervalSince1970 * 1000).rounded()))
        guard let line = Self.encodeLine(obj) else { return }
        appendLine(line, to: fileURL, openingHandle: true)
    }

    /// Append one already-serialized line to a target URL. When `openingHandle`
    /// is true the per-session handle is reused; otherwise (index) a fresh handle
    /// is opened/closed per write (index writes are rare).
    private func appendLine(_ line: String, to url: URL, openingHandle: Bool) {
        // MUST run on `queue`.
        let data = Data((line + "\n").utf8)
        if openingHandle {
            if handle == nil { handle = openForAppend(url) }
            guard let h = handle else { markFailed(url); return }
            do {
                try h.write(contentsOf: data)
                // Best-effort flush so an inspector reading mid-session sees it.
                try? h.synchronize()
            } catch {
                markFailed(url)
            }
        } else {
            guard let h = openForAppend(url) else { markFailed(url); return }
            defer { try? h.close() }
            do {
                try h.write(contentsOf: data)
                try? h.synchronize()
            } catch {
                markFailed(url)
            }
        }
    }

    /// Append an index row on the serial queue (own fresh handle each time).
    private func appendIndex(_ fields: [String: JSONEncodableValue]) {
        queue.async { [weak self] in
            guard let self else { return }
            self.appendIndexLocked(fields)
        }
    }

    /// MUST already be running on `queue`. Index counterpart of `writeLocked`.
    private func appendIndexLocked(_ fields: [String: JSONEncodableValue]) {
        guard !failed else { return }
        var obj = fields
        obj["ts"] = .int(Int((Date().timeIntervalSince1970 * 1000).rounded()))
        guard let line = Self.encodeLine(obj) else { return }
        appendLine(line, to: indexURL, openingHandle: false)
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

    /// Record (once) that a write failed, so the session isn't silently broken
    /// AND we don't spam. After this, all writes are no-ops.
    private func markFailed(_ url: URL) {
        guard !failed else { return }
        failed = true
        ConductorLog.component("session-transcript")
            .error("transcript write failed for \(url.path); disabling transcript for this session")
    }

    // MARK: - Encoding

    /// Encode a flat dictionary of encodable values to a single-line JSON string.
    /// Sorted keys for stable, diffable output. Shared with sibling cockpit-domain
    /// writers (e.g. #decision-divergence-journal) so the JSON token logic stays in
    /// one place.
    static func encodeLine(_ fields: [String: JSONEncodableValue]) -> String? {
        var parts: [String] = []
        for key in fields.keys.sorted() {
            guard let v = fields[key] else { continue }
            parts.append("\(jsonString(key)):\(v.jsonString)")
        }
        return "{" + parts.joined(separator: ",") + "}"
    }

    /// JSON-escape a string scalar.
    static func jsonString(_ s: String) -> String {
        var out = "\""
        for ch in s.unicodeScalars {
            switch ch {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if ch.value < 0x20 {
                    out += String(format: "\\u%04x", ch.value)
                } else {
                    out.unicodeScalars.append(ch)
                }
            }
        }
        out += "\""
        return out
    }

    // MARK: - Truncation

    /// Truncate large payloads to keep the file diagnosable but sane (~2KB default).
    /// Appends a marker noting how many chars were dropped.
    private func truncate(_ s: String, limit: Int = 2048) -> String {
        guard s.count > limit else { return s }
        let dropped = s.count - limit
        return String(s.prefix(limit)) + "…[+\(dropped) chars truncated]"
    }

    // MARK: - Paths & timestamps

    /// `~/.paradigm/conductor/atrium`
    static func atriumDirectory() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".paradigm", isDirectory: true)
            .appendingPathComponent("conductor", isDirectory: true)
            .appendingPathComponent("atrium", isDirectory: true)
    }

    /// Filesystem-safe, sortable timestamp for the filename, e.g. 20260615T134501.
    private static func fileTimestamp(_ date: Date) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.timeZone = TimeZone.current
        fmt.dateFormat = "yyyyMMdd'T'HHmmss"
        return fmt.string(from: date)
    }

    /// ISO8601 timestamp for index rows.
    private func isoNow() -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime]
        return fmt.string(from: Date())
    }
}

/// Minimal JSON-value bridge for transcript fields. Lets call sites mix scalars
/// in a `[String: JSONEncodableValue]` literal without a heavyweight Codable
/// model, and renders each to its JSON token. `ExpressibleBy*Literal` keeps the
/// dictionary literals terse (string/int/bool literals work directly).
enum JSONEncodableValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByBooleanLiteral {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case stringArray([String])
    case null

    init(stringLiteral value: String) { self = .string(value) }
    init(integerLiteral value: Int) { self = .int(value) }
    init(booleanLiteral value: Bool) { self = .bool(value) }

    /// Bridge an `Int32` (e.g. a pid) — used explicitly at call sites.
    static func int32(_ v: Int32) -> JSONEncodableValue { .int(Int(v)) }

    /// Bridge an optional Int → null when absent (usage fields).
    static func intOpt(_ v: Int?) -> JSONEncodableValue { v.map { .int($0) } ?? .null }

    var jsonString: String {
        switch self {
        case .string(let s): return SessionTranscript.jsonString(s)
        case .int(let i): return String(i)
        case .double(let d):
            if d.rounded() == d, abs(d) < 1e15 { return String(format: "%.4f", d) }
            return String(d)
        case .bool(let b): return b ? "true" : "false"
        case .stringArray(let arr):
            return "[" + arr.map { SessionTranscript.jsonString($0) }.joined(separator: ",") + "]"
        case .null: return "null"
        }
    }
}
