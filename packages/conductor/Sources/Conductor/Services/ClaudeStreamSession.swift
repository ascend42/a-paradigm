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

    // MARK: - Process

    private let projectPath: String
    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?

    /// Off-main line framer (Sendable) shared with the readabilityHandler.
    private let framer = LineFramer()

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
        stderr.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            let text = String(decoding: data, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return }
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
            ConductorLog.flow("claude-turn-exchange")
                .info("ClaudeStreamSession started @ \(self.projectPath) (PID \(proc.processIdentifier))")

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

    /// Tear down: terminate the process, close stdin, detach handlers.
    func shutdown() {
        cancelWatchdog()
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        if let proc = process, proc.isRunning {
            proc.terminate()
        }
        try? stdinPipe?.fileHandleForWriting.close()
        status = .stopped
        ConductorLog.signal("agent-stopped")
            .info("ClaudeStreamSession shut down")
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

    private func writeTurn(_ text: String) {
        guard let stdin = stdinPipe else { return }
        let turn = OutboundUserTurn(
            message: .init(content: [.init(text: text)])
        )
        let encoder = JSONEncoder()
        guard var data = try? encoder.encode(turn) else { return }
        data.append(0x0A) // newline-terminate the NDJSON line
        stdin.fileHandleForWriting.write(data)
        ConductorLog.flow("claude-turn-exchange")
            .info("Sent user turn (\(text.count) chars)")
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
            case .unknown(let type):
                // Tolerated, but TRACE it — a `result` showing up here would mean
                // a decode divergence (the exact failure class for this bug).
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
        status = .idle
        ConductorLog.signal("agent-turn-complete")
            .info("watchdog — turn went quiet \(self.watchdogQuiet)s with no result; settling to idle")
    }

    private func applySystemInit(_ sys: SystemInit) {
        if let sid = sys.sessionId { sessionId = sid }
        if let m = sys.model { model = m }
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
                messages[index].toolCalls.append(
                    ToolCall(id: id, name: name, inputSummary: summary, state: .running, resultSummary: nil)
                )
            case .thinking, .toolResult, .other:
                break // thinking is intentionally not rendered
            }
        }
    }

    private func applyToolResults(_ user: UserMessage) {
        for block in user.message.content {
            guard case .toolResult(let toolUseId, let content, let isError) = block else { continue }
            // Match the tool_use id across all messages.
            for mi in messages.indices {
                if let ci = messages[mi].toolCalls.firstIndex(where: { $0.id == toolUseId }) {
                    messages[mi].toolCalls[ci].state = isError ? .failed : .succeeded
                    messages[mi].toolCalls[ci].resultSummary = content
                    break
                }
            }
        }
    }

    private func applyResult(_ result: ResultEvent) {
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
        // The turn is settled — leave .running. This is the assignment whose
        // absence (in the stuck-running run) kept the composer's old guard locked.
        status = .idle

        ConductorLog.signal("agent-turn-complete")
            .info("applyResult DONE — status now idle, totalCost \(self.totalCostUsd ?? -1)")
    }

    private func handleTermination(exitCode: Int32) {
        cancelWatchdog()
        if let index = currentAgentIndex, messages.indices.contains(index) {
            messages[index].isStreaming = false
        }
        currentAgentIndex = nil
        if status == .stopped { return } // already shut down deliberately
        status = exitCode == 0 ? .stopped : .error
        ConductorLog.signal("agent-exited")
            .info("claude stream session exited code \(exitCode)")
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
