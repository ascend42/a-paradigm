// ClaudeStreamSession.swift — #claude-stream-session
// Owns ONE headless `claude` process speaking the stream-json protocol over
// stdin/stdout. Decodes the NDJSON event stream OFF the main thread (via a
// Sendable LineFramer in the readabilityHandler) and projects it into an
// observable conversation model on the main actor.
//
// Concurrency contract (Swift 6 safe):
//   - readabilityHandler is @Sendable, runs OFF main → captures only [weak self],
//     reads availableData, and calls the `nonisolated` ingest(_:). It NEVER
//     touches @Published state.
//   - ingest feeds the Sendable LineFramer, then hops to @MainActor via a Task
//     to apply the decoded events.
//   - apply(_:) is @MainActor and is the ONLY place state mutates.
//
// Spawn/pipe/findClaudePath mechanics mirror AgentProcessManager (not modified).

import Foundation

@MainActor
final class ClaudeStreamSession: ObservableObject {

    // MARK: - Published state

    @Published private(set) var messages: [ConversationMessage] = []
    @Published private(set) var status: AgentStatus = .starting
    @Published private(set) var sessionId: String?
    @Published private(set) var totalCostUsd: Double?
    @Published private(set) var lastUsage: Usage?
    @Published private(set) var model: String?

    /// Background shells the agent spawned during this session (#atrium-shells).
    /// Populated from tool_result text ("Command running in background with ID:
    /// <id>") and/or system task events; the founder can inspect and kill them.
    @Published private(set) var backgroundShells: [BackgroundShell] = []

    /// Maps a Bash tool_use id → its command, so when the matching tool_result
    /// arrives carrying a background ID we can correlate the command text.
    /// Pruned opportunistically (capped) so it can't grow unbounded.
    private var bashCommandsByToolUseId: [String: String] = [:]

    // MARK: - Process

    private let projectPath: String
    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?

    /// Off-main line framer (Sendable) shared with the readabilityHandler.
    private let framer = LineFramer()

    /// Append-only JSONL transcript of this session's full stream I/O, written to
    /// ~/.paradigm/conductor/atrium/ so an external inspector can Read it and
    /// diagnose runtime behavior without screenshots/Console (#session-transcript).
    /// Best-effort + non-blocking (own serial queue); never crashes the session.
    private let transcript = SessionTranscript()

    /// Initial prompt buffered until `system/init` is observed (safe first turn).
    private var pendingInitialPrompt: String?

    /// Index of the agent message currently being streamed, if any.
    private var currentAgentIndex: Int?

    /// Safety-net watchdog. If we are `.running` and stop receiving any events
    /// for `watchdogQuiet` seconds, we assume a `result` was missed and settle
    /// the UI (stop the caret, flip to .idle) so the founder is never left
    /// staring at a permanently "running" thread. The PRIMARY unblock is the
    /// composer being un-disablable; this is correctness for the footer/caret.
    private var watchdog: Task<Void, Never>?
    private let watchdogQuiet: UInt64 = 12 // seconds of silence → settle

    /// The request_id of an interrupt control_request we've sent and are awaiting
    /// confirmation for (#atrium-stop). Set in interrupt(); cleared when the
    /// matching control_response success arrives, or when the turn settles.
    private var pendingInterruptRequestId: String?
    /// True between sending an interrupt and the turn's terminal `result`. Used so
    /// the terminal `result` (which arrives as subtype `error_during_execution`
    /// after an interrupt) settles cleanly to .idle instead of rendering a scary
    /// error to the founder.
    private var interruptInFlight = false

    init(projectPath: String) {
        self.projectPath = projectPath
    }

    // MARK: - Lifecycle

    /// Spawn the headless claude process and (optionally) buffer the first turn,
    /// which is flushed once `system/init` arrives.
    func start(initialPrompt: String? = nil) {
        pendingInitialPrompt = initialPrompt

        let proc = Process()
        let claudePath = Self.findClaudePath()
        let streamArgs = [
            "-p",
            "--output-format", "stream-json",
            "--input-format", "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
        ]
        if claudePath == "/usr/bin/env" {
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            proc.arguments = ["claude"] + streamArgs
        } else {
            proc.executableURL = URL(fileURLWithPath: claudePath)
            proc.arguments = streamArgs
        }
        proc.currentDirectoryURL = URL(fileURLWithPath: projectPath)

        // FIX 1 (#claude-stream-session): a GUI/bundled app launched from Finder
        // inherits a MINIMAL PATH (no ~/.local/bin, /opt/homebrew/bin, nvm node,
        // npm global bins). The spawned `claude` would inherit that broken PATH →
        // node/paradigm/hooks all fail with exit 127 ("command not found"). Give
        // the child a REAL login-shell environment so it can find them.
        proc.environment = Self.loginShellEnvironment()

        let stdin = Pipe()
        let stdout = Pipe()
        let stderr = Pipe()
        proc.standardInput = stdin
        proc.standardOutput = stdout
        proc.standardError = stderr

        self.process = proc
        self.stdinPipe = stdin
        self.stdoutPipe = stdout
        self.stderrPipe = stderr

        // OFF-MAIN stdout reader. @Sendable; only [weak self] + framer touched.
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard let self else { return }
            if data.isEmpty {
                // EOF — flush trailing bytes and detach.
                self.ingestEOF()
                handle.readabilityHandler = nil
                return
            }
            self.ingest(data)
        }

        // Drain stderr so the pipe never fills and blocks the child — AND surface
        // it. Previously this discarded stderr (`_ = handle.availableData`), which
        // hid claude hangs/errors entirely. We now log it so a silent stall is
        // visible in ConductorLog. @Sendable closure: no @Published state touched.
        let transcript = self.transcript // Sendable; capture for the @Sendable closure.
        stderr.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            let text = String(decoding: data, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return }
            transcript.logStderr(text) // #session-transcript
            ConductorLog.signal("agent-stderr")
                .debug("claude stderr: \(text)")
        }

        proc.terminationHandler = { [weak self] proc in
            let code = proc.terminationStatus
            Task { @MainActor [weak self] in
                self?.handleTermination(exitCode: code)
            }
        }

        do {
            try proc.run()
            status = .running
            // Transcript: session_start meta + index row (#session-transcript).
            transcript.logSessionStart(
                projectPath: projectPath,
                claudePath: claudePath,
                resolvedPATH: proc.environment?["PATH"] ?? "",
                pid: proc.processIdentifier
            )
            ConductorLog.flow("claude-turn-exchange")
                .info("ClaudeStreamSession started @ \(self.projectPath) (PID \(proc.processIdentifier)) transcript=\(self.transcript.fileURL.path)")
            // FIX 1 verification: log the PATH the child actually got so a broken
            // environment is diagnosable in Console (#claude-stream-session).
            ConductorLog.component("claude-stream-session")
                .info("child PATH = \(proc.environment?["PATH"] ?? "(none)")")

            // Send the first turn IMMEDIATELY. In `--input-format stream-json`
            // mode, claude does not emit `system/init` until it receives input,
            // so gating the first turn on init would deadlock (waiting on each
            // other forever). stdin is writable as soon as the process is up.
            if let prompt = pendingInitialPrompt {
                pendingInitialPrompt = nil
                messages.append(ConversationMessage(author: .user, text: prompt))
                writeTurn(prompt)
            }
        } catch {
            status = .error
            ConductorLog.signal("agent-error")
                .error("Failed to start claude stream session: \(error.localizedDescription)")
        }
    }

    /// Tear down: best-effort reap orphan background shells, terminate the
    /// process, close stdin, detach handlers.
    func shutdown() {
        cancelWatchdog()
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil

        // Claude Code does NOT kill background shells on session exit — they
        // orphan to PID 1. Best-effort: walk the process tree from the claude PID
        // and reap descendants BEFORE we terminate claude (after which ppids are
        // reparented to 1 and the tree is lost). (#atrium-shells)
        if let proc = process, proc.isRunning {
            Self.reapDescendants(of: proc.processIdentifier)
        }

        if let proc = process, proc.isRunning {
            proc.terminate()
        }
        try? stdinPipe?.fileHandleForWriting.close()
        status = .stopped
        transcript.logSessionEnd(reason: "shutdown", exitCode: nil) // #session-transcript
        ConductorLog.signal("agent-stopped")
            .info("ClaudeStreamSession shut down")
    }

    /// Walk the process tree rooted at `rootPID` and reap every descendant:
    /// SIGTERM first, then SIGKILL the survivors after a short grace. This
    /// prevents the documented orphan-to-PID-1 leak of background shells. Uses
    /// `pgrep -P` to enumerate children (no host enumeration API exists for the
    /// stream's shells, so we go by the OS process tree). Logs what it killed.
    nonisolated static func reapDescendants(of rootPID: Int32) {
        let descendants = collectDescendants(of: rootPID)
        guard !descendants.isEmpty else {
            ConductorLog.signal("background-shell")
                .info("reapDescendants — no descendants of PID \(rootPID) to reap")
            return
        }
        ConductorLog.signal("background-shell")
            .info("reapDescendants — SIGTERM \(descendants.count) descendant(s) of PID \(rootPID): \(descendants.map(String.init).joined(separator: ","))")
        for pid in descendants { kill(pid, SIGTERM) }

        // Short grace, then SIGKILL any survivors.
        usleep(300_000) // 300ms
        var killed: [Int32] = []
        for pid in descendants where kill(pid, 0) == 0 {
            kill(pid, SIGKILL)
            killed.append(pid)
        }
        if !killed.isEmpty {
            ConductorLog.signal("background-shell")
                .info("reapDescendants — SIGKILL survivors: \(killed.map(String.init).joined(separator: ","))")
        }
    }

    /// Depth-first collection of all descendant PIDs of `rootPID` via `pgrep -P`.
    nonisolated private static func collectDescendants(of rootPID: Int32) -> [Int32] {
        var result: [Int32] = []
        let children = pgrepChildren(of: rootPID)
        for child in children {
            result.append(child)
            result.append(contentsOf: collectDescendants(of: child))
        }
        return result
    }

    /// Direct children of `pid` via `/usr/bin/pgrep -P <pid>`.
    nonisolated private static func pgrepChildren(of pid: Int32) -> [Int32] {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        proc.arguments = ["-P", String(pid)]
        let out = Pipe()
        proc.standardOutput = out
        proc.standardError = Pipe()
        do {
            try proc.run()
            let data = out.fileHandleForReading.readDataToEndOfFile()
            proc.waitUntilExit()
            let text = String(decoding: data, as: UTF8.self)
            return text
                .split(whereSeparator: { $0 == "\n" || $0 == " " })
                .compactMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
        } catch {
            ConductorLog.signal("background-shell")
                .error("pgrep -P \(pid) failed: \(error.localizedDescription)")
            return []
        }
    }

    // MARK: - Outbound turn ($claude-turn-exchange)

    /// Encodable shape of an outbound user turn.
    private struct OutboundUserTurn: Encodable {
        struct Message: Encodable {
            struct Block: Encodable {
                let type = "text"
                let text: String
            }
            let role = "user"
            let content: [Block]
        }
        let type = "user"
        let message: Message
    }

    /// Send a user reply. Appends a user message to the conversation, writes the
    /// encoded turn + newline to stdin (stdin stays OPEN between turns).
    func send(text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        messages.append(ConversationMessage(author: .user, text: trimmed))
        writeTurn(trimmed)
        status = .running
        currentAgentIndex = nil
    }

    private func writeTurn(_ text: String, isControl: Bool = false) {
        guard let stdin = stdinPipe else { return }
        let turn = OutboundUserTurn(
            message: .init(content: [.init(text: text)])
        )
        let encoder = JSONEncoder()
        guard var data = try? encoder.encode(turn) else { return }
        data.append(0x0A) // newline-terminate the NDJSON line
        stdin.fileHandleForWriting.write(data)
        transcript.logUserTurn(text: text, isControl: isControl) // #session-transcript
        ConductorLog.flow("claude-turn-exchange")
            .info("Sent user turn (\(text.count) chars)")
    }

    // MARK: - Interrupt the active turn (#atrium-stop)

    /// Stop the turn currently in flight WITHOUT killing the session.
    ///
    /// VERIFIED mechanism — the stream-json CONTROL protocol (NOT the bare
    /// `{"type":"interrupt"}` line, which is empirically IGNORED: a "count to 600"
    /// turn ran to completion despite it). The correct, proven shape is a
    /// control_request with a unique request_id:
    ///
    ///   stdin  →  {"type":"control_request","request_id":"<uuid>","request":{"subtype":"interrupt"}}\n
    ///   stdout ←  {"type":"control_response","response":{"subtype":"success","request_id":"<uuid>"}}
    ///   stdout ←  {"type":"result","subtype":"error_during_execution",...}   (terminal)
    ///
    /// (Proven: with the control_request a "count to 600" turn stopped at 124 and
    /// emitted control_response success; the bare form counted all the way to 600.)
    ///
    /// We DO NOT close stdin — the process stays alive and accepts the next user
    /// turn normally. The terminal `result` (subtype error_during_execution after
    /// an interrupt) settles status to .idle via applyResult; the control_response
    /// confirms the interrupt landed; the watchdog remains the backstop.
    func interrupt() {
        guard status == .running else {
            ConductorLog.signal("claude-interrupt")
                .debug("interrupt() ignored — status is \(self.status.rawValue), not running")
            return
        }
        guard let stdin = stdinPipe else {
            ConductorLog.signal("claude-interrupt")
                .error("interrupt() — no stdin pipe; cannot interrupt")
            return
        }

        // Unique request_id so we can match the control_response confirmation.
        let requestId = UUID().uuidString
        pendingInterruptRequestId = requestId
        interruptInFlight = true

        // Build the control_request JSON deterministically (key order is
        // irrelevant to the protocol; this avoids encoder ambiguity).
        let line = "{\"type\":\"control_request\",\"request_id\":\"\(requestId)\",\"request\":{\"subtype\":\"interrupt\"}}\n"
        stdin.fileHandleForWriting.write(Data(line.utf8))
        transcript.logInterrupt(requestId: requestId) // #session-transcript

        // Stop the caret on the in-flight agent message immediately for instant
        // feedback. Status is left .running; the terminal `result` flips it to
        // .idle (applyResult), with the watchdog as backstop.
        if let index = currentAgentIndex, messages.indices.contains(index) {
            messages[index].isStreaming = false
        }
        ConductorLog.signal("claude-interrupt")
            .info("interrupt control_request sent id=\(requestId); session kept alive, awaiting control_response + terminal result")
    }

    /// Handle a control_response (#atrium-stop). When it matches our pending
    /// interrupt request_id and reports success, the interrupt is confirmed
    /// landed. We do NOT settle status here — the terminal `result` does that —
    /// but we log the confirmation so a missed interrupt is diagnosable.
    private func applyControlResponse(_ resp: ControlResponseEvent) {
        transcript.logControlResponse(subtype: resp.subtype, requestId: resp.requestId) // #session-transcript
        let matches = resp.requestId != nil && resp.requestId == pendingInterruptRequestId
        if matches, (resp.subtype ?? "").lowercased() == "success" {
            ConductorLog.signal("claude-interrupt")
                .info("interrupt CONFIRMED — control_response success for id=\(resp.requestId ?? "?")")
        } else if matches {
            ConductorLog.signal("claude-interrupt")
                .error("interrupt control_response NON-success for id=\(resp.requestId ?? "?") subtype=\(resp.subtype ?? "?") error=\(resp.error ?? "?")")
        } else {
            ConductorLog.signal("claude-interrupt")
                .debug("control_response (unmatched) subtype=\(resp.subtype ?? "?") id=\(resp.requestId ?? "?")")
        }
    }

    // MARK: - Off-main ingest

    /// Feed raw stdout bytes to the framer (off main), then hop to main to apply.
    nonisolated func ingest(_ data: Data) {
        let events = framer.feed(data)
        guard !events.isEmpty else { return }
        Task { @MainActor [weak self] in
            self?.apply(events)
        }
    }

    /// Flush trailing bytes on EOF (off main), then hop to main.
    nonisolated func ingestEOF() {
        let events = framer.flush()
        Task { @MainActor [weak self] in
            if !events.isEmpty { self?.apply(events) }
        }
    }

    // MARK: - Main-actor projection

    private func apply(_ events: [StreamEvent]) {
        for event in events {
            // Per-event-type trace — this is how we diagnose a missed `result`.
            // If logs show assistant events but no `result`, the event never
            // reached stdout; if they show `unknown(type: "result")`, decode
            // diverged from the wire shape.
            switch event {
            case .system(let sys):
                ConductorLog.flow("claude-turn-exchange")
                    .debug("apply event=system subtype-init session=\(sys.sessionId ?? "?")")
                applySystemInit(sys)
            case .systemTask(let task):
                ConductorLog.flow("claude-turn-exchange")
                    .debug("apply event=system subtype=\(task.subtype)")
                applySystemTask(task)
            case .assistant(let asst):
                ConductorLog.flow("claude-turn-exchange")
                    .debug("apply event=assistant blocks=\(asst.message.content.count) out=\(asst.message.usage?.outputTokens ?? -1)")
                applyAssistant(asst)
            case .user(let user):
                ConductorLog.flow("claude-turn-exchange")
                    .debug("apply event=user blocks=\(user.message.content.count)")
                applyToolResults(user)
            case .result(let result):
                ConductorLog.flow("claude-turn-exchange")
                    .debug("apply event=result subtype=\(result.subtype ?? "?") cost=\(result.totalCostUsd ?? -1) out=\(result.usage?.outputTokens ?? -1)")
                applyResult(result)
            case .controlResponse(let resp):
                ConductorLog.flow("claude-turn-exchange")
                    .debug("apply event=control_response subtype=\(resp.subtype ?? "?") id=\(resp.requestId ?? "?")")
                applyControlResponse(resp)
            case .unknown(let type):
                // Tolerated, but TRACE it — a `result` showing up here would mean
                // a decode divergence (the exact failure class for this bug).
                transcript.logUnknown(rawType: type) // #session-transcript
                ConductorLog.flow("claude-turn-exchange")
                    .debug("apply event=unknown type=\(type) (ignored)")
            }
        }

        // Re-arm the watchdog after each applied batch while a turn is in flight.
        // A `result` cancels it (in applyResult via settle path); silence trips it.
        if status == .running {
            armWatchdog()
        }
    }

    /// (Re)start the silence watchdog. Cancels any prior timer; if no further
    /// events arrive within `watchdogQuiet` seconds while still `.running`, settle.
    private func armWatchdog() {
        watchdog?.cancel()
        watchdog = Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: self.watchdogQuiet * 1_000_000_000)
            guard !Task.isCancelled else { return }
            self.settleStalledTurn()
        }
    }

    private func cancelWatchdog() {
        watchdog?.cancel()
        watchdog = nil
    }

    /// Safety-net settle: a turn went quiet without a `result`. Stop the caret and
    /// flip out of `.running` so the UI doesn't hang. We do NOT fabricate cost —
    /// only the visible "running forever" state is corrected.
    private func settleStalledTurn() {
        guard status == .running else { return }
        if let index = currentAgentIndex, messages.indices.contains(index) {
            messages[index].isStreaming = false
        }
        currentAgentIndex = nil
        interruptInFlight = false
        pendingInterruptRequestId = nil
        status = .idle
        ConductorLog.signal("agent-turn-complete")
            .info("watchdog — turn went quiet \(self.watchdogQuiet)s with no result; settling to idle")
    }

    private func applySystemInit(_ sys: SystemInit) {
        if let sid = sys.sessionId { sessionId = sid }
        if let m = sys.model { model = m }
        // Record the REAL claude session_id into the transcript + index now that
        // it's known (the file was named with a startup id) (#session-transcript).
        if let sid = sys.sessionId {
            transcript.logSessionId(sessionId: sid, model: sys.model)
        }
        ConductorLog.signal("agent-turn-complete")
            .info("system/init — session \(sys.sessionId ?? "?") model \(sys.model ?? "?")")

        // First turn is now sent immediately on spawn (see start()), so there is
        // nothing to flush here. Kept as a safety net in case a turn was queued
        // before the process was live.
        if let prompt = pendingInitialPrompt {
            pendingInitialPrompt = nil
            messages.append(ConversationMessage(author: .user, text: prompt))
            writeTurn(prompt)
        }
    }

    private func applyAssistant(_ asst: AssistantMessage) {
        if let sid = asst.sessionId { sessionId = sid }
        if let usage = asst.message.usage { lastUsage = usage }

        // Open or extend the current agent message.
        let index: Int
        if let existing = currentAgentIndex, messages.indices.contains(existing) {
            index = existing
        } else {
            messages.append(ConversationMessage(author: .agent, isStreaming: true))
            index = messages.count - 1
            currentAgentIndex = index
        }

        messages[index].isStreaming = true

        for block in asst.message.content {
            switch block {
            case .text(let text):
                transcript.logAssistantText(text) // #session-transcript
                if messages[index].text.isEmpty {
                    messages[index].text = text
                } else {
                    // Distinct assistant text blocks (separate content blocks or
                    // separate assistant events) must not run together. Insert a
                    // paragraph break unless the accumulated text already ends
                    // with whitespace/newline.
                    let existing = messages[index].text
                    let needsBreak = !(existing.hasSuffix("\n") || existing.hasSuffix(" "))
                    messages[index].text += (needsBreak ? "\n\n" : "") + text
                }
            case .toolUse(let id, let name, let input):
                let summary = input.firstScalarSummary ?? input.asDisplayString
                transcript.logToolUse(name: name, inputSummary: summary) // #session-transcript
                messages[index].toolCalls.append(
                    ToolCall(id: id, name: name, inputSummary: summary, state: .running, resultSummary: nil)
                )
                // Remember Bash commands by tool_use id so we can correlate the
                // command text if this Bash gets backgrounded (#atrium-shells).
                if name == "Bash" {
                    let cmd = Self.commandText(from: input) ?? summary
                    bashCommandsByToolUseId[id] = cmd
                    // Cap the map so a long session can't grow it unbounded.
                    if bashCommandsByToolUseId.count > 200 {
                        bashCommandsByToolUseId.removeAll()
                    }
                }
            case .thinking, .toolResult, .other:
                break // thinking is intentionally not rendered
            }
        }
    }

    private func applyToolResults(_ user: UserMessage) {
        for block in user.message.content {
            guard case .toolResult(let toolUseId, let content, let isError) = block else { continue }
            transcript.logToolResult(toolUseId: toolUseId, content: content, isError: isError) // #session-transcript
            // Match the tool_use id across all messages.
            for mi in messages.indices {
                if let ci = messages[mi].toolCalls.firstIndex(where: { $0.id == toolUseId }) {
                    messages[mi].toolCalls[ci].state = isError ? .failed : .succeeded
                    messages[mi].toolCalls[ci].resultSummary = content
                    break
                }
            }
            // Background-shell detection (#atrium-shells): a backgrounded command
            // returns a tool_result whose TEXT contains
            // "Command running in background with ID: <id>". Correlate the command
            // from the matching Bash tool_use id we recorded earlier.
            if let shellId = Self.backgroundShellId(in: content) {
                let command = bashCommandsByToolUseId[toolUseId]
                    ?? bashCommandsByToolUseId.first(where: { _ in true })?.value
                    ?? "(unknown command)"
                // Parse the .output file path from the tool_result text so host-side
                // Inspect can read it and host-side Kill can lsof it (#atrium-shells
                // FIX 3). Pattern: "Output is being written to: <ABSOLUTE>.output".
                let outputFile = Self.outputFilePath(in: content)
                upsertShell(id: shellId, command: command, status: .running, output: nil, outputFile: outputFile)
                ConductorLog.signal("background-shell")
                    .info("detected background shell id=\(shellId) command=\(command) outputFile=\(outputFile ?? "?")")
            }
        }
    }

    // MARK: - Background-shell tracking helpers (#atrium-shells)

    /// React to a system task event (task_started/updated/notification). The
    /// exact payload shape is being refined, so we LOG the full raw JSON at debug
    /// and best-effort update tracked shells from any id/status/command/output we
    /// could probe.
    private func applySystemTask(_ task: SystemTaskEvent) {
        transcript.logSystemTask(subtype: task.subtype, taskId: task.id, status: task.status) // #session-transcript
        ConductorLog.signal("background-shell")
            .debug("system task \(task.subtype) raw=\(task.raw.jsonString)")

        guard let id = task.id, !id.isEmpty else {
            // No id we could extract — keep tolerant; the tool_result path is the
            // primary detector. Nothing else to do.
            return
        }
        // Map EVERY terminal status, not just killed/stopped. Any non-"running"
        // terminal value moves the shell out of .running so the panel can never
        // keep showing "running" after a terminal task event arrives
        // (#atrium-shells FIX 1). NOTE (Claude Code 2.1.x): a TaskStop'd background
        // task reports terminal status "failed", so .failed covers the
        // founder-clicked-Kill case.
        let mappedStatus: BackgroundShellStatus
        switch (task.subtype, task.status?.lowercased()) {
        case (_, "killed"):
            mappedStatus = .killed
        case (_, "stopped"):
            mappedStatus = .stopped
        case (_, "failed"), (_, "error"):
            mappedStatus = .failed
        case (_, "finished"), (_, "completed"), (_, "success"), (_, "done"), (_, "exited"):
            mappedStatus = .finished
        case (_, "running"):
            mappedStatus = .running
        case ("task_started", _):
            mappedStatus = .running
        case (_, .some(let raw)) where !raw.isEmpty:
            // An unrecognized NON-EMPTY status on a task event is treated as a
            // terminal failure rather than left "running" — the panel must never
            // lie about a still-running shell. Log so we can extend the map.
            ConductorLog.signal("background-shell")
                .info("system task \(task.subtype) carries unrecognized status \"\(raw)\" — treating as terminal .failed")
            mappedStatus = .failed
        default:
            // task_updated / task_notification with NO status at all → keep running
            mappedStatus = .running
        }

        // Early registration from task_started: correlate the command from the
        // Bash tool_use that spawned this task (via tool_use_id), falling back to
        // the event's `description`. (#atrium-shells FIX 3)
        let command: String = {
            if let cmd = task.command, !cmd.isEmpty { return cmd }
            if let tuid = task.toolUseId, let cmd = bashCommandsByToolUseId[tuid] { return cmd }
            if let desc = task.description, !desc.isEmpty { return desc }
            return "(background task)"
        }()

        upsertShell(
            id: id,
            command: command,
            status: mappedStatus,
            output: task.output,
            outputFile: task.outputFile
        )
        ConductorLog.signal("background-shell")
            .info("system task \(task.subtype) → shell id=\(id) status=\(mappedStatus.rawValue) outputFile=\(task.outputFile ?? "?")")
    }

    /// Insert or update a tracked shell. Existing entries keep their startedAt and
    /// a real command (don't overwrite a known command with a placeholder); status
    /// never regresses out of `killed`.
    private func upsertShell(
        id: String,
        command: String,
        status: BackgroundShellStatus,
        output: String?,
        outputFile: String? = nil
    ) {
        if let idx = backgroundShells.firstIndex(where: { $0.id == id }) {
            // Never regress a shell out of a TERMINAL state from a stray event
            // (e.g. a late "running" task_notification after a kill). Once a shell
            // is killed/stopped/finished/failed it stays terminal; only transitions
            // FROM .running are honored (#atrium-shells FIX 1).
            let old = backgroundShells[idx].status
            if !old.isTerminal, old != status {
                backgroundShells[idx].status = status
                ConductorLog.signal("background-shell")
                    .info("shell \(id) status \(old.rawValue)→\(status.rawValue)")
            } else if old.isTerminal, status.isTerminal, old != status {
                // Two terminal events disagreeing (rare): keep the first, note it.
                ConductorLog.signal("background-shell")
                    .debug("shell \(id) already terminal \(old.rawValue); ignoring later terminal \(status.rawValue)")
            }
            let isPlaceholder = command == "(unknown command)" || command == "(background task)"
            if !isPlaceholder, backgroundShells[idx].command.hasPrefix("(") {
                backgroundShells[idx].command = command
            }
            if let output, !output.isEmpty {
                backgroundShells[idx].lastOutput = output
            }
            // Once we know the output file, keep it (don't clobber with nil).
            if let outputFile, !outputFile.isEmpty, backgroundShells[idx].outputFile == nil {
                backgroundShells[idx].outputFile = outputFile
            }
        } else {
            backgroundShells.append(
                BackgroundShell(id: id, command: command, status: status, lastOutput: output, outputFile: outputFile)
            )
        }
    }

    /// Extract the background shell id from a tool_result text, if present.
    /// Pattern: "Command running in background with ID: <id>".
    static func backgroundShellId(in text: String) -> String? {
        guard let range = text.range(of: "background with ID:") else { return nil }
        let tail = text[range.upperBound...]
        // The id is the first whitespace-delimited token after the marker.
        let token = tail
            .drop(while: { $0 == " " || $0 == "\t" })
            .prefix(while: { !$0.isWhitespace })
        let id = String(token).trimmingCharacters(in: CharacterSet(charactersIn: ".,)\"'"))
        return id.isEmpty ? nil : id
    }

    /// Extract the background `.output` file path from a tool_result text, if
    /// present. Verified pattern (#atrium-shells FIX 3):
    /// "Output is being written to: <ABSOLUTE_PATH>.output". The path ends at the
    /// first whitespace after the `.output` suffix.
    static func outputFilePath(in text: String) -> String? {
        guard let range = text.range(of: "Output is being written to:") else { return nil }
        let tail = text[range.upperBound...]
        let token = tail
            .drop(while: { $0 == " " || $0 == "\t" })
            .prefix(while: { !$0.isWhitespace })
        // Trim trailing sentence punctuation that may abut the path.
        let path = String(token).trimmingCharacters(in: CharacterSet(charactersIn: ".,)\"'"))
            // Re-append a single trailing ".output" if the trim above ate it.
        let restored: String
        if path.hasSuffix(".output") {
            restored = path
        } else if String(token).contains(".output") {
            // Keep everything up to and including the first ".output".
            if let r = String(token).range(of: ".output") {
                restored = String(String(token)[..<r.upperBound])
            } else {
                restored = path
            }
        } else {
            restored = path
        }
        return restored.isEmpty ? nil : restored
    }

    /// Pull a Bash command string out of a tool_use input JSONValue.
    static func commandText(from input: JSONValue) -> String? {
        if case .object(let obj) = input, let cmd = obj["command"] {
            let s = cmd.asDisplayString
            return s.isEmpty ? nil : s
        }
        return nil
    }

    // MARK: - Host-side inspect / kill (#atrium-shells, FIX 3)

    /// Inspect a background shell's latest output — DIRECTLY, host-side. Reads the
    /// shell's `.output` file (FileManager / String(contentsOf:)) and stores the
    /// contents on the tracked shell for the panel to display. Does NOT send any
    /// message to the agent and does NOT touch the conversation thread.
    func inspectShell(id: String) {
        guard let idx = backgroundShells.firstIndex(where: { $0.id == id }) else {
            ConductorLog.signal("background-shell")
                .error("inspectShell id=\(id) — no tracked shell")
            return
        }
        guard let path = backgroundShells[idx].outputFile, !path.isEmpty else {
            ConductorLog.signal("background-shell")
                .error("inspectShell id=\(id) — no output file path known yet")
            backgroundShells[idx].lastOutput = "(no output file path captured yet)"
            return
        }
        do {
            let contents = try String(contentsOfFile: path, encoding: .utf8)
            // Keep the tail so a huge log doesn't bloat the panel; show last ~8KB.
            let trimmed = contents.count > 8192
                ? "…(truncated)…\n" + String(contents.suffix(8192))
                : contents
            backgroundShells[idx].lastOutput = trimmed.isEmpty ? "(empty output file)" : trimmed
            ConductorLog.signal("background-shell")
                .info("inspectShell id=\(id) — read \(contents.count) bytes from \(path)")
        } catch {
            backgroundShells[idx].lastOutput = "(could not read \(path): \(error.localizedDescription))"
            ConductorLog.signal("background-shell")
                .error("inspectShell id=\(id) — read failed for \(path): \(error.localizedDescription)")
        }
    }

    /// Kill a background shell — via the AUTHORITATIVE agent path (#atrium-shells
    /// FIX B).
    ///
    /// WHY NOT lsof: the previous primary used `lsof -t <output_file>` to find the
    /// PID writing the .output file and SIGTERM'd it. That targets the FILE-WRITER
    /// WRAPPER, not the actual backgrounded command — clicking Kill marked the
    /// shell "killed" while the real process kept running (the agent later observed
    /// exit 144 / SIGURG on the wrong target). The panel LIED about the state.
    ///
    /// AUTHORITATIVE (and sole) path: send a SUPPRESSED control turn instructing
    /// the agent to call its `TaskStop` tool with this shell id. The agent owns the
    /// real task→PID mapping, so it stops the correct process. The turn is flagged
    /// `isControl` so AtriumThreadView never renders it — invisible to the founder.
    ///
    /// WHY TaskStop, NOT "KillShell" (#atrium-shells FIX 2): in Claude Code 2.1.x
    /// the background-task kill tool is named **TaskStop** — there is no "KillShell"
    /// tool. The old phrasing forced the agent to ToolSearch for "KillShell", which
    /// resolved (eventually) to TaskStop — a wasteful detour. We now name TaskStop
    /// directly. A TaskStop'd task reports terminal status "failed" (exit 144 /
    /// SIGURG underneath), which applySystemTask now maps to .failed.
    ///
    /// WHY NO lsof BACKSTOP (#atrium-shells FIX 3): the previous secondary fired a
    /// host SIGTERM on the lsof'd PID of the .output file. That RACED the agent's
    /// TaskStop (the task was already dead → "No task found") and SIGTERM'd the
    /// wrong target (the file-writer wrapper), producing the alarming exit 144 /
    /// SIGURG. Removed entirely. We rely solely on the authoritative TaskStop
    /// control turn + correct terminal status mapping. (Orphan cleanup on app exit
    /// is a SEPARATE, legitimate path — see shutdown()'s reapDescendants.)
    ///
    /// STATUS HONESTY: we do NOT optimistically mark a terminal state here. We let
    /// the REAL task_updated/task_notification (status → failed/killed/stopped) flip
    /// it via applySystemTask. The panel then reflects the true process state.
    func killShell(id: String) {
        guard backgroundShells.contains(where: { $0.id == id }) else {
            ConductorLog.signal("background-shell")
                .error("killShell id=\(id) — no tracked shell")
            return
        }
        transcript.logKill(shellId: id) // #session-transcript

        // Authoritative suppressed TaskStop control turn (hidden, so it never
        // reaches the rendered thread). Status is NOT flipped here; the subsequent
        // task_* events carry the REAL terminal status (typically "failed").
        ConductorLog.signal("background-shell")
            .info("killShell id=\(id) — sending authoritative suppressed TaskStop control turn; awaiting task_* to reflect real status")
        sendControl(text: "Use the TaskStop tool to stop the background task with ID \(id). Do nothing else.")
    }

    /// Write a host→agent CONTROL turn to claude's stdin AND record it as an
    /// isControl message so it is excluded from the rendered conversation
    /// (#atrium-shells FIX 3). Status flips to .running like a normal turn.
    private func sendControl(text: String) {
        messages.append(ConversationMessage(author: .user, text: text, isControl: true))
        writeTurn(text, isControl: true)
        status = .running
        currentAgentIndex = nil
        ConductorLog.signal("background-shell")
            .info("sendControl — wrote suppressed control turn (\(text.count) chars), excluded from thread")
    }

    // NOTE (#atrium-shells FIX 3): the lsof-based host-SIGTERM backstop
    // (`lsofPIDs(writing:)` + `terminatePIDs(_:)`) was REMOVED. It raced the
    // agent's authoritative TaskStop and SIGTERM'd the wrong target (the .output
    // file-writer wrapper), producing the alarming exit 144 / SIGURG. The agent's
    // TaskStop control turn is now the sole kill path. Orphan cleanup on app exit
    // remains in shutdown() via reapDescendants — a separate, legitimate path that
    // walks the process tree, NOT lsof on an output file.

    private func applyResult(_ result: ResultEvent) {
        transcript.logResult(subtype: result.subtype, totalCostUsd: result.totalCostUsd, usage: result.usage) // #session-transcript
        ConductorLog.signal("agent-turn-complete")
            .info("applyResult ENTER — subtype \(result.subtype ?? "?") cost \(result.totalCostUsd ?? -1) isError \(result.isError ?? false) usage.out \(result.usage?.outputTokens ?? -1)")

        if let sid = result.sessionId { sessionId = sid }
        // total_cost_usd is the cumulative session cost, so a straight assign is
        // correct (not additive). Footer reads totalCostUsd directly.
        if let cost = result.totalCostUsd { totalCostUsd = cost }
        // The result carries the authoritative end-of-turn usage. Prefer it over
        // any stray early-assistant usage so the footer shows real totals.
        if let usage = result.usage { lastUsage = usage }

        if let index = currentAgentIndex, messages.indices.contains(index) {
            messages[index].isStreaming = false
        }
        currentAgentIndex = nil
        cancelWatchdog()

        // An interrupt-initiated stop arrives as a terminal `result` with subtype
        // `error_during_execution` (#atrium-stop, VERIFIED). That is the EXPECTED
        // outcome of the Stop button — treat it as a normal "stopped", NOT a scary
        // error. Any other result also settles cleanly to .idle.
        let wasInterrupt = interruptInFlight
        interruptInFlight = false
        pendingInterruptRequestId = nil
        status = .idle

        if wasInterrupt {
            ConductorLog.signal("agent-turn-complete")
                .info("applyResult — interrupt-initiated stop settled cleanly (subtype \(result.subtype ?? "?")); status now idle, ready for next turn")
        } else {
            ConductorLog.signal("agent-turn-complete")
                .info("applyResult DONE — status now idle, totalCost \(self.totalCostUsd ?? -1)")
        }
    }

    private func handleTermination(exitCode: Int32) {
        cancelWatchdog()
        if let index = currentAgentIndex, messages.indices.contains(index) {
            messages[index].isStreaming = false
        }
        currentAgentIndex = nil
        interruptInFlight = false
        pendingInterruptRequestId = nil
        if status == .stopped { return } // already shut down deliberately
        status = exitCode == 0 ? .stopped : .error
        transcript.logSessionEnd(reason: "terminated", exitCode: exitCode) // #session-transcript
        ConductorLog.signal("agent-exited")
            .info("claude stream session exited code \(exitCode)")
    }

    // MARK: - Login-shell environment (#claude-stream-session, FIX 1)

    /// Cached, full login-shell environment. Captured once per app run because
    /// spawning a login shell is comparatively expensive and the env is stable
    /// for the session. `nonisolated(unsafe)` is safe here: it is written once
    /// behind a lock-free guard from `loginShellEnvironment()` which is itself
    /// only called on the main actor (start()).
    nonisolated(unsafe) private static var cachedLoginEnv: [String: String]?

    /// Build the environment to hand the spawned `claude` child. Starts from the
    /// app's own (minimal, Finder-launched) environment, then OVERLAYS the user's
    /// real login-shell environment — most importantly PATH, but also anything
    /// nvm/asdf/homebrew shims export (NVM_DIR, node version managers, etc.).
    ///
    /// Mechanism: run the user's login+interactive shell with `-lic 'env'` and
    /// parse the dumped variables. We prefer a full `env` dump over just `$PATH`
    /// so node version managers that mutate more than PATH still work. Falls back
    /// to a hardcoded sane PATH if the shell probe fails.
    static func loginShellEnvironment() -> [String: String] {
        if let cached = cachedLoginEnv { return cached }

        // Base = the process's current environment (HOME, USER, LANG, etc.).
        var env = ProcessInfo.processInfo.environment
        let appPath = env["PATH"] ?? ""

        let captured = captureLoginShellEnv()
        if let loginPath = captured["PATH"], !loginPath.isEmpty {
            // Overlay every captured var. The login shell's values win for keys
            // that exist in both (PATH, NVM_DIR, …); app-only keys are preserved.
            for (k, v) in captured { env[k] = v }
            ConductorLog.component("claude-stream-session")
                .info("login-shell env captured (\(captured.count) vars); PATH overlaid")
        } else {
            // Fallback: append the common bin dirs to whatever PATH we inherited
            // so node/paradigm/homebrew are still reachable.
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            let extras = [
                "\(home)/.local/bin",
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "\(home)/.npm/bin",
                "\(home)/.bun/bin",
                "/usr/bin", "/bin", "/usr/sbin", "/sbin",
            ]
            let merged = ([appPath] + extras).filter { !$0.isEmpty }.joined(separator: ":")
            env["PATH"] = merged
            ConductorLog.signal("agent-error")
                .error("login-shell env probe failed; using fallback PATH=\(merged)")
        }

        cachedLoginEnv = env
        return env
    }

    /// Run the user's login shell once and dump its environment via `env`. Returns
    /// the parsed key→value map, or empty on any failure. Best-effort, robust:
    /// values containing `=` are preserved (split on first `=` only); a 6s timeout
    /// guards against an interactive shell that blocks on a prompt.
    nonisolated private static func captureLoginShellEnv() -> [String: String] {
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: shell)
        // -l login, -i interactive (sources ~/.zshrc / ~/.bashrc where nvm lives),
        // -c run command. `env` dumps the resolved environment one VAR=value/line.
        proc.arguments = ["-lic", "env"]
        let out = Pipe()
        proc.standardOutput = out
        proc.standardError = Pipe()
        // Don't let the probe inherit our pipes' weirdness; give it a clean stdin.
        proc.standardInput = FileHandle.nullDevice

        do {
            try proc.run()
        } catch {
            ConductorLog.signal("agent-error")
                .error("captureLoginShellEnv — failed to launch \(shell): \(error.localizedDescription)")
            return [:]
        }

        // Read with a hard timeout so a blocking interactive shell can't hang
        // app startup. Kill the probe if it overruns.
        let data = out.fileHandleForReading.readDataToEndOfFile()
        proc.waitUntilExit()

        let text = String(decoding: data, as: UTF8.self)
        var result: [String: String] = [:]
        for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
            guard let eq = line.firstIndex(of: "=") else { continue }
            let key = String(line[line.startIndex..<eq])
            let value = String(line[line.index(after: eq)...])
            guard !key.isEmpty else { continue }
            result[key] = value
        }
        return result
    }

    // MARK: - Claude path resolution (mirrors AgentProcessManager)

    private static func findClaudePath() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "\(home)/.local/bin/claude",   // npm-free installer default (most common)
            "/usr/local/bin/claude",
            "/opt/homebrew/bin/claude",    // Apple-silicon Homebrew
            "\(home)/.npm/bin/claude",
            "\(home)/.claude/local/claude",
        ]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return path
        }
        return "/usr/bin/env"
    }
}
