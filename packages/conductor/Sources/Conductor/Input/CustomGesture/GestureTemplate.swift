// GestureTemplate.swift — #gesture-template
// Named gesture template with normalized joint position sequence.
// Persisted to ~/.conductor/gestures/ as JSON.

import Foundation

/// A recorded custom gesture template for DTW-based matching.
struct GestureTemplate: Codable, Identifiable {
    /// Unique identifier.
    let id: String

    /// User-assigned name for this gesture.
    let name: String

    /// Normalized time-series of hand pose frames.
    let frames: [HandPoseFrame]

    /// DTW distance threshold for accepting a match (lower = stricter).
    var matchThreshold: Double

    /// When this template was created.
    let createdAt: Date

    /// How many recordings were averaged to create this template.
    let recordingCount: Int

    /// The ConductorAction name bound to this gesture.
    var boundAction: String

    // MARK: - Persistence

    /// Base directory for gesture templates.
    static var gesturesDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".conductor/gestures")
    }

    /// Save this template to disk.
    func save() throws {
        let dir = Self.gesturesDirectory
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let file = dir.appendingPathComponent("\(id).json")
        let data = try JSONEncoder().encode(self)
        try data.write(to: file)
    }

    /// Load all saved templates.
    static func loadAll() -> [GestureTemplate] {
        let dir = gesturesDirectory
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: nil
        ) else { return [] }

        return files
            .filter { $0.pathExtension == "json" }
            .compactMap { url -> GestureTemplate? in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? JSONDecoder().decode(GestureTemplate.self, from: data)
            }
    }

    /// Delete this template from disk.
    func delete() {
        let file = Self.gesturesDirectory.appendingPathComponent("\(id).json")
        try? FileManager.default.removeItem(at: file)
    }
}
