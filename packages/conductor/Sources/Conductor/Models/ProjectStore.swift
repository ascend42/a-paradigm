// ProjectStore.swift — #project-store
// Recent project persistence with pin management.
// Storage: ~/.paradigm/conductor/recent-projects.json

import Foundation

/// A project that Conductor remembers for quick re-launch.
struct RecentProject: Codable, Identifiable, Equatable {
    let id: UUID
    var path: String
    var name: String
    var lastAgentRole: String?
    var lastOpened: Date
    var pinned: Bool

    static func == (lhs: RecentProject, rhs: RecentProject) -> Bool {
        lhs.id == rhs.id
    }
}

/// Persists and manages the list of recent projects.
@MainActor
final class ProjectStore: ObservableObject {

    @Published private(set) var projects: [RecentProject] = []

    private static let storePath: URL = {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".paradigm/conductor/recent-projects.json")
    }()

    init() {
        load()
        discoverAndMerge()
    }

    // MARK: - CRUD

    /// Add a new project or update an existing one (matched by path).
    func addOrUpdate(path: String, name: String, role: String? = nil) {
        if let idx = projects.firstIndex(where: { $0.path == path }) {
            projects[idx].name = name
            projects[idx].lastOpened = .now
            if let role { projects[idx].lastAgentRole = role }
        } else {
            let project = RecentProject(
                id: UUID(),
                path: path,
                name: name,
                lastAgentRole: role,
                lastOpened: .now,
                pinned: false
            )
            projects.append(project)
        }
        save()
    }

    func remove(id: UUID) {
        projects.removeAll { $0.id == id }
        save()
    }

    func togglePin(id: UUID) {
        guard let idx = projects.firstIndex(where: { $0.id == id }) else { return }
        projects[idx].pinned.toggle()
        save()
    }

    /// Projects sorted: pinned first, then by lastOpened descending.
    var sorted: [RecentProject] {
        projects.sorted { a, b in
            if a.pinned != b.pinned { return a.pinned }
            return a.lastOpened > b.lastOpened
        }
    }

    // MARK: - Discovery

    /// Merge projects discovered from ~/.paradigm/sessions/ into the store.
    /// Idempotent — safe to call on every launch.
    func discoverAndMerge() {
        let discovered = CheckpointReader.discoverAllProjects()
        var changed = false

        for meta in discovered {
            if let idx = projects.firstIndex(where: { $0.path == meta.path }) {
                // Update name and lastOpened if discovered data is newer
                if meta.lastSeen > projects[idx].lastOpened {
                    projects[idx].name = meta.name
                    projects[idx].lastOpened = meta.lastSeen
                    changed = true
                }
            } else {
                // New project — add it
                projects.append(RecentProject(
                    id: UUID(),
                    path: meta.path,
                    name: meta.name,
                    lastAgentRole: nil,
                    lastOpened: meta.lastSeen,
                    pinned: false
                ))
                changed = true
            }
        }

        if changed {
            save()
            ConductorLog.component("project-store")
                .info("Discovered \(discovered.count) projects, store now has \(self.projects.count)")
        }
    }

    // MARK: - Persistence

    func load() {
        let fm = FileManager.default
        guard fm.fileExists(atPath: Self.storePath.path) else { return }

        do {
            let data = try Data(contentsOf: Self.storePath)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            projects = try decoder.decode([RecentProject].self, from: data)
        } catch {
            ConductorLog.component("project-store")
                .error("Failed to load recent projects: \(error.localizedDescription)")
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
            let data = try encoder.encode(projects)
            try data.write(to: Self.storePath, options: .atomic)
        } catch {
            ConductorLog.component("project-store")
                .error("Failed to save recent projects: \(error.localizedDescription)")
        }
    }
}
