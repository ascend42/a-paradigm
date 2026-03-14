// AutoLinkCoordinator.swift — #auto-link-coordinator
// Subscribes to ClaudeCodeDetector's instance stream and auto-creates
// agent parts in The Score. Links detected CC instances to Symphony
// so they can participate in inter-agent messaging.

import Foundation
import SwiftUI

/// Monitors ClaudeCodeDetector for new instances and automatically
/// registers them as agent parts in The Score.
@MainActor
final class AutoLinkCoordinator: ObservableObject {

    /// Map of agentId to identity for auto-linked agents.
    @Published var autoLinkedAgents: [String: AgentIdentity] = [:]

    /// User preference controlling whether auto-linking is active.
    @AppStorage("symphonyEnabled") private var symphonyEnabled: Bool = false

    /// Background task monitoring the instance stream.
    private var monitorTask: Task<Void, Never>?

    /// Reference to the agent part manager for registration.
    private let partManager: AgentPartManager

    /// Reference to the note relay for starting/stopping.
    private let relay: NoteRelay

    /// Tracks which project directories we've already registered agents for,
    /// keyed by projectDirectory string.
    private var registeredProjects: [String: String] = [:]

    init(partManager: AgentPartManager, relay: NoteRelay) {
        self.partManager = partManager
        self.relay = relay
    }

    // MARK: - Start/Stop

    /// Begin monitoring the detector's instance stream for new CC instances.
    func start(detector: ClaudeCodeDetector) {
        guard symphonyEnabled else {
            ConductorLog.component("auto-link-coordinator")
                .info("Symphony disabled in preferences — skipping auto-link")
            return
        }

        stop()

        ConductorLog.component("auto-link-coordinator").info("Auto-link started")

        // Clean stale agents on startup
        partManager.cleanStaleAgents()

        monitorTask = Task { [weak self] in
            for await instances in detector.instanceStream {
                guard !Task.isCancelled else { break }
                await self?.handleInstanceUpdate(instances)
            }
        }
    }

    /// Stop monitoring and cancel the background task.
    func stop() {
        monitorTask?.cancel()
        monitorTask = nil
        ConductorLog.component("auto-link-coordinator").info("Auto-link stopped")
    }

    // MARK: - Instance Handling

    /// Handle an updated list of detected instances.
    private func handleInstanceUpdate(_ instances: [ClaudeCodeInstance]) {
        guard symphonyEnabled else { return }

        let currentProjectDirs = Set(instances.compactMap(\.projectDirectory))
        let previousProjectDirs = Set(registeredProjects.keys)

        // Register agents for new instances
        for instance in instances {
            guard let projectDir = instance.projectDirectory else { continue }

            // Skip if we already have an agent for this project directory
            guard registeredProjects[projectDir] == nil else { continue }

            let role = deriveRole(for: projectDir)
            let identity = partManager.registerAgent(projectDir: projectDir, role: role)

            autoLinkedAgents[identity.id] = identity
            registeredProjects[projectDir] = identity.id

            ConductorLog.signal("agent-part-created")
                .info("Auto-linked agent: \(identity.id) for \(projectDir)")

            // Start relay if not already running
            if !relay.isRelaying {
                relay.start()
            }
        }

        // Handle lost instances — clean up agents whose project dirs are no longer present
        for projectDir in previousProjectDirs {
            if !currentProjectDirs.contains(projectDir) {
                handleInstanceLost(projectDir: projectDir)
            }
        }
    }

    /// Clean up an agent part when its instance is no longer detected.
    private func handleInstanceLost(projectDir: String) {
        guard let agentId = registeredProjects[projectDir] else { return }

        // Only unregister if no other instances need this agent
        // (another instance might share the same project directory)
        partManager.unregisterAgent(agentId)
        autoLinkedAgents.removeValue(forKey: agentId)
        registeredProjects.removeValue(forKey: projectDir)

        ConductorLog.component("auto-link-coordinator")
            .info("Unlinked agent: \(agentId) (instance lost)")

        // Stop relay if no more agents
        if autoLinkedAgents.isEmpty && relay.isRelaying {
            relay.stop()
        }
    }

    // MARK: - Role Derivation

    /// Derive the role for a new agent in a project.
    /// First agent for a project gets "core", subsequent agents get "agent-2", "agent-3", etc.
    private func deriveRole(for projectDir: String) -> String {
        let projectName = partManager.resolveProjectName(projectDir)

        // Check existing registrations for this project
        let existingForProject = partManager.registeredAgents.filter { $0.project == projectName }

        if existingForProject.isEmpty {
            return "core"
        }

        // Find the highest existing agent number
        var maxNum = 1
        for agent in existingForProject {
            if agent.role.hasPrefix("agent-") {
                if let numStr = agent.role.split(separator: "-").last,
                   let num = Int(numStr) {
                    maxNum = max(maxNum, num)
                }
            }
        }

        return "agent-\(maxNum + 1)"
    }
}
