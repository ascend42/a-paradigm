// AgentGroup.swift — #agent-group
// Manual agent grouping for cross-project orchestration.
// Groups persist to ~/.paradigm/conductor/groups.json.

import Foundation

/// A named group of agents from potentially different projects.
struct AgentGroup: Codable, Identifiable, Equatable {
    let id: UUID
    var name: String
    var agents: [GroupedAgent]
    var color: String           // CSS-style: "blue", "purple", "orange", etc.
    var created: Date

    static func == (lhs: AgentGroup, rhs: AgentGroup) -> Bool {
        lhs.id == rhs.id
    }
}

/// An agent reference within a group.
struct GroupedAgent: Codable, Identifiable, Equatable {
    let id: UUID
    var projectPath: String
    var agentRole: String
    var symphonyAgentId: String     // e.g. "deus-backend/architect"
    var managedAgentId: UUID?       // links to AgentProcessManager if running

    static func == (lhs: GroupedAgent, rhs: GroupedAgent) -> Bool {
        lhs.id == rhs.id
    }
}

/// Persists and manages agent groups.
@MainActor
final class AgentGroupStore: ObservableObject {

    @Published var groups: [AgentGroup] = []

    private static let storePath: URL = {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".paradigm/conductor/groups.json")
    }()

    init() {
        load()
    }

    // MARK: - Group CRUD

    @discardableResult
    func createGroup(name: String, color: String = "blue") -> AgentGroup {
        let group = AgentGroup(
            id: UUID(),
            name: name,
            agents: [],
            color: color,
            created: .now
        )
        groups.append(group)
        save()
        return group
    }

    func deleteGroup(id: UUID) {
        groups.removeAll { $0.id == id }
        save()
    }

    func renameGroup(id: UUID, name: String) {
        guard let idx = groups.firstIndex(where: { $0.id == id }) else { return }
        groups[idx].name = name
        save()
    }

    func setGroupColor(id: UUID, color: String) {
        guard let idx = groups.firstIndex(where: { $0.id == id }) else { return }
        groups[idx].color = color
        save()
    }

    // MARK: - Agent Management

    func addAgent(groupId: UUID, agent: GroupedAgent) {
        guard let idx = groups.firstIndex(where: { $0.id == groupId }) else { return }
        // Prevent duplicates
        guard !groups[idx].agents.contains(where: { $0.symphonyAgentId == agent.symphonyAgentId }) else { return }
        groups[idx].agents.append(agent)
        save()
    }

    func removeAgent(groupId: UUID, agentId: UUID) {
        guard let idx = groups.firstIndex(where: { $0.id == groupId }) else { return }
        groups[idx].agents.removeAll { $0.id == agentId }
        save()
    }

    func moveAgent(fromGroupId: UUID, toGroupId: UUID, agentId: UUID) {
        guard let fromIdx = groups.firstIndex(where: { $0.id == fromGroupId }),
              let toIdx = groups.firstIndex(where: { $0.id == toGroupId }),
              let agentIdx = groups[fromIdx].agents.firstIndex(where: { $0.id == agentId }) else { return }

        let agent = groups[fromIdx].agents.remove(at: agentIdx)
        groups[toIdx].agents.append(agent)
        save()
    }

    /// Link a managed agent ID to a grouped agent (when the process is spawned).
    func linkManagedAgent(symphonyAgentId: String, managedAgentId: UUID) {
        for groupIdx in groups.indices {
            for agentIdx in groups[groupIdx].agents.indices {
                if groups[groupIdx].agents[agentIdx].symphonyAgentId == symphonyAgentId {
                    groups[groupIdx].agents[agentIdx].managedAgentId = managedAgentId
                    return
                }
            }
        }
    }

    /// All agents across all groups for quick lookups.
    var allGroupedAgents: [GroupedAgent] {
        groups.flatMap(\.agents)
    }

    /// Agents not in any group (from a given list of known agents).
    func ungroupedAgents(from knownAgents: [AgentIdentity]) -> [AgentIdentity] {
        let groupedIds = Set(allGroupedAgents.map(\.symphonyAgentId))
        return knownAgents.filter { !groupedIds.contains($0.id) }
    }

    // MARK: - Persistence

    func load() {
        let fm = FileManager.default
        guard fm.fileExists(atPath: Self.storePath.path) else { return }

        do {
            let data = try Data(contentsOf: Self.storePath)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            groups = try decoder.decode([AgentGroup].self, from: data)
        } catch {
            ConductorLog.component("agent-group-store")
                .error("Failed to load groups: \(error.localizedDescription)")
        }
    }

    func save() {
        let fm = FileManager.default
        let dir = Self.storePath.deletingLastPathComponent()
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }

        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(groups)
            try data.write(to: Self.storePath, options: .atomic)
        } catch {
            ConductorLog.component("agent-group-store")
                .error("Failed to save groups: \(error.localizedDescription)")
        }
    }
}
