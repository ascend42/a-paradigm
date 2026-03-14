// AgentPartManager.swift — #agent-part-manager
// Manages agent registration/unregistration in The Score.
// Agents are identified by {project}/{role} and registered at ~/.paradigm/score/agents/.

import Foundation

/// Manages agent parts (registration, unregistration, scanning) in The Score.
@MainActor
final class AgentPartManager: ObservableObject {

    /// Currently registered agents discovered from the score directory.
    @Published var registeredAgents: [AgentIdentity] = []

    // MARK: - Registration

    /// Register a new agent part for a project directory.
    /// Creates the agent directory and writes identity.json.
    /// Returns the created identity.
    @discardableResult
    func registerAgent(projectDir: String, role: String? = nil) -> AgentIdentity {
        ScoreIO.ensureScoreDirs()

        let project = resolveProjectName(projectDir)
        let agentRole = role ?? "core"
        let agentId = "\(project)/\(agentRole)"
        let agentDir = ScoreIO.agentDir(for: agentId)

        // Ensure agent directory exists
        let fm = FileManager.default
        if !fm.fileExists(atPath: agentDir.path) {
            try? fm.createDirectory(at: agentDir, withIntermediateDirectories: true)
        }

        let identity = AgentIdentity(
            id: agentId,
            name: "\(project) (\(agentRole))",
            type: .agent,
            project: project,
            role: agentRole,
            pid: Int(ProcessInfo.processInfo.processIdentifier),
            startedAt: ISO8601DateFormatter().string(from: Date()),
            label: nil
        )

        ScoreIO.writeJson(identity, to: ScoreIO.identityPath(for: agentId))

        ConductorLog.signal("agent-part-created")
            .info("Registered agent: \(agentId)")

        // Refresh the published list
        registeredAgents = scanAllAgents()

        return identity
    }

    /// Unregister an agent by removing its directory.
    /// Returns true if the agent was found and removed.
    @discardableResult
    func unregisterAgent(_ agentId: String) -> Bool {
        let agentDir = ScoreIO.agentDir(for: agentId)
        let fm = FileManager.default

        guard fm.fileExists(atPath: agentDir.path) else { return false }

        do {
            try fm.removeItem(at: agentDir)
            ConductorLog.component("agent-part-manager")
                .info("Unregistered agent: \(agentId)")

            // Refresh the published list
            registeredAgents = scanAllAgents()
            return true
        } catch {
            ConductorLog.component("agent-part-manager")
                .info("Failed to unregister \(agentId): \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - Scanning

    /// Scan the agents directory for all registered agent identities.
    func scanAllAgents() -> [AgentIdentity] {
        ScoreIO.ensureScoreDirs()

        let fm = FileManager.default
        let agentsPath = ScoreIO.agentsDir.path

        guard fm.fileExists(atPath: agentsPath) else { return [] }

        var agents: [AgentIdentity] = []

        // Agent IDs use {project}/{role} — two levels of nesting
        guard let projectDirs = try? fm.contentsOfDirectory(atPath: agentsPath) else { return [] }

        for projectDir in projectDirs {
            let projectPath = ScoreIO.agentsDir.appendingPathComponent(projectDir).path
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: projectPath, isDirectory: &isDir), isDir.boolValue else { continue }

            guard let roleDirs = try? fm.contentsOfDirectory(atPath: projectPath) else { continue }

            for roleDir in roleDirs {
                let agentId = "\(projectDir)/\(roleDir)"
                let identityPath = ScoreIO.identityPath(for: agentId)

                guard let identity: AgentIdentity = ScoreIO.readJson(at: identityPath) else { continue }
                agents.append(identity)
            }
        }

        return agents
    }

    /// Remove agents whose PID is no longer alive.
    /// Returns the number of stale agents cleaned.
    @discardableResult
    func cleanStaleAgents() -> Int {
        let agents = scanAllAgents()
        var cleaned = 0

        for agent in agents {
            if !isProcessAlive(pid: agent.pid) {
                if unregisterAgent(agent.id) {
                    cleaned += 1
                }
            }
        }

        if cleaned > 0 {
            ConductorLog.component("agent-part-manager")
                .info("Cleaned \(cleaned) stale agent(s)")
        }

        return cleaned
    }

    // MARK: - Project Name Resolution

    /// Resolve the project name from config.yaml or fall back to the directory basename.
    func resolveProjectName(_ projectDir: String) -> String {
        // Try config.yaml first
        let configPath = (projectDir as NSString).appendingPathComponent(".paradigm/config.yaml")
        if let content = try? String(contentsOfFile: configPath, encoding: .utf8) {
            // Match: project: <name>
            let lines = content.components(separatedBy: "\n")
            for line in lines {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("project:") {
                    let value = String(trimmed.dropFirst("project:".count))
                        .trimmingCharacters(in: .whitespaces)
                        .replacingOccurrences(of: "\"", with: "")
                        .replacingOccurrences(of: "'", with: "")
                    if !value.isEmpty {
                        return sanitizeId(value)
                    }
                }
            }
        }

        // Fall back to directory name
        let dirName = URL(fileURLWithPath: projectDir).lastPathComponent
        return sanitizeId(dirName)
    }

    /// Sanitize a name for use as an agent ID component.
    /// Lowercase, replace non-alphanumeric with hyphens, limit to 40 chars.
    func sanitizeId(_ name: String) -> String {
        var sanitized = name.lowercased()

        // Replace non-alphanumeric (except hyphens) with hyphens
        sanitized = sanitized.map { char -> Character in
            if char.isLetter || char.isNumber || char == "-" {
                return char
            }
            return "-"
        }.map(String.init).joined()

        // Collapse multiple hyphens
        while sanitized.contains("--") {
            sanitized = sanitized.replacingOccurrences(of: "--", with: "-")
        }

        // Strip leading/trailing hyphens
        sanitized = sanitized.trimmingCharacters(in: CharacterSet(charactersIn: "-"))

        // Limit to 40 chars
        if sanitized.count > 40 {
            sanitized = String(sanitized.prefix(40))
        }

        return sanitized.isEmpty ? "unknown" : sanitized
    }

    // MARK: - Private

    /// Check if a process is still running via kill(pid, 0).
    private func isProcessAlive(pid: Int) -> Bool {
        kill(Int32(pid), 0) == 0
    }
}
