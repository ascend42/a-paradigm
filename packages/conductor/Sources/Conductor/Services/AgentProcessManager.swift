// AgentProcessManager.swift — #agent-process-manager
// Spawns and manages headless `claude` processes.
// No terminal windows — Conductor owns the process, captures stdout/stderr.

import Foundation

/// Status of a managed headless agent.
enum AgentStatus: String {
    case starting
    case running
    case idle
    case stopped
    case error
}

/// A headless Claude Code agent process managed by Conductor.
struct ManagedAgent: Identifiable {
    let id: UUID
    let process: Process
    let projectPath: String
    let agentRole: String
    let stdinPipe: Pipe
    let stdoutPipe: Pipe
    let stderrPipe: Pipe
    var status: AgentStatus
    var lastOutputLines: [String]
    let startedAt: Date

    /// Whether the underlying process is still running.
    var isAlive: Bool { process.isRunning }
}

/// Spawns and manages headless `claude` child processes.
@MainActor
final class AgentProcessManager: ObservableObject {

    @Published private(set) var runningAgents: [ManagedAgent] = []

    private let maxOutputLines = 200

    // MARK: - Spawn

    /// Spawn a new headless Claude Code session.
    /// - Parameters:
    ///   - projectPath: Absolute path to the project directory.
    ///   - role: Agent role hint (e.g., "architect", "builder").
    ///   - initialPrompt: Optional prompt to pipe to stdin after launch.
    /// - Returns: The newly created `ManagedAgent`.
    @discardableResult
    func spawn(
        projectPath: String,
        role: String = "agent",
        initialPrompt: String? = nil
    ) throws -> ManagedAgent {
        let process = Process()

        // Find claude executable
        let claudePath = Self.findClaudePath()
        if claudePath == "/usr/bin/env" {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["claude", "--dangerously-skip-permissions"]
        } else {
            process.executableURL = URL(fileURLWithPath: claudePath)
            process.arguments = ["--dangerously-skip-permissions"]
        }
        process.currentDirectoryURL = URL(fileURLWithPath: projectPath)

        // Set up pipes
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()

        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        let agentId = UUID()

        var agent = ManagedAgent(
            id: agentId,
            process: process,
            projectPath: projectPath,
            agentRole: role,
            stdinPipe: stdinPipe,
            stdoutPipe: stdoutPipe,
            stderrPipe: stderrPipe,
            status: .starting,
            lastOutputLines: [],
            startedAt: .now
        )

        // Capture stdout
        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor [weak self] in
                self?.appendOutput(agentId: agentId, text: line)
            }
        }

        // Capture stderr
        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor [weak self] in
                self?.appendOutput(agentId: agentId, text: "[stderr] \(line)")
            }
        }

        // Termination handler
        process.terminationHandler = { [weak self] proc in
            Task { @MainActor [weak self] in
                self?.handleTermination(agentId: agentId, exitCode: proc.terminationStatus)
            }
        }

        try process.run()

        agent.status = .running
        runningAgents.append(agent)

        ConductorLog.flow("agent-spawn")
            .info("Spawned headless agent: \(role) @ \(projectPath) (PID \(process.processIdentifier))")

        // Send initial prompt if provided
        if let prompt = initialPrompt {
            sendInput(id: agentId, text: prompt)
        }

        return agent
    }

    // MARK: - Control

    /// Send text to an agent's stdin.
    func sendInput(id: UUID, text: String) {
        guard let agent = runningAgents.first(where: { $0.id == id }) else { return }
        guard let data = (text + "\n").data(using: .utf8) else { return }
        agent.stdinPipe.fileHandleForWriting.write(data)
    }

    /// Stop a specific agent.
    func stop(id: UUID) {
        guard let idx = runningAgents.firstIndex(where: { $0.id == id }) else { return }
        let agent = runningAgents[idx]

        if agent.process.isRunning {
            agent.process.terminate()
        }

        runningAgents[idx].status = .stopped
        ConductorLog.signal("agent-stopped")
            .info("Stopped agent: \(agent.agentRole) @ \(agent.projectPath)")
    }

    /// Stop all running agents.
    func stopAll() {
        for i in runningAgents.indices {
            if runningAgents[i].process.isRunning {
                runningAgents[i].process.terminate()
            }
            runningAgents[i].status = .stopped
        }
        ConductorLog.signal("agents-stopped-all")
            .info("Stopped all \(self.runningAgents.count) agents")
    }

    /// Get the last N lines of output for an agent.
    func getOutput(id: UUID, lines: Int = 50) -> [String] {
        guard let agent = runningAgents.first(where: { $0.id == id }) else { return [] }
        return Array(agent.lastOutputLines.suffix(lines))
    }

    /// Remove stopped agents from the list.
    func pruneStoppedAgents() {
        runningAgents.removeAll { $0.status == .stopped || $0.status == .error }
    }

    /// Clean up all agents on app termination.
    func cleanup() {
        for agent in runningAgents where agent.process.isRunning {
            agent.process.terminate()
        }
        runningAgents.removeAll()
    }

    // MARK: - Private

    private func appendOutput(agentId: UUID, text: String) {
        guard let idx = runningAgents.firstIndex(where: { $0.id == agentId }) else { return }
        let lines = text.components(separatedBy: "\n").filter { !$0.isEmpty }
        runningAgents[idx].lastOutputLines.append(contentsOf: lines)

        // Trim to maxOutputLines
        if runningAgents[idx].lastOutputLines.count > maxOutputLines {
            runningAgents[idx].lastOutputLines = Array(
                runningAgents[idx].lastOutputLines.suffix(maxOutputLines)
            )
        }
    }

    private func handleTermination(agentId: UUID, exitCode: Int32) {
        guard let idx = runningAgents.firstIndex(where: { $0.id == agentId }) else { return }

        if exitCode == 0 {
            runningAgents[idx].status = .stopped
            ConductorLog.signal("agent-exited")
                .info("Agent exited normally: \(self.runningAgents[idx].agentRole)")
        } else {
            runningAgents[idx].status = .error
            ConductorLog.signal("agent-error")
                .info("Agent exited with code \(exitCode): \(self.runningAgents[idx].agentRole)")
        }
    }

    /// Find the `claude` executable on the system.
    private static func findClaudePath() -> String {
        // Check common locations
        let candidates = [
            "/usr/local/bin/claude",
            "\(FileManager.default.homeDirectoryForCurrentUser.path)/.npm/bin/claude",
            "\(FileManager.default.homeDirectoryForCurrentUser.path)/.claude/local/claude",
        ]

        for path in candidates {
            if FileManager.default.isExecutableFile(atPath: path) {
                return path
            }
        }

        // Fallback to PATH resolution via /usr/bin/env
        return "/usr/bin/env"
    }
}
