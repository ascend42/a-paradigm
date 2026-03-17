// CheckpointReader.swift — #checkpoint-reader
// Reads .paradigm/session-checkpoint.json and pending handoff files.
// Wire-compatible with paradigm-mcp SessionCheckpoint / PendingHandoff types.

import CryptoKit
import Foundation

/// A session checkpoint written by `paradigm_session_checkpoint`.
struct SessionCheckpoint: Codable {
    let phase: String              // planning, implementing, validating, complete
    let context: String
    let timestamp: Double          // unix ms
    let sessionId: String
    var plan: String?
    var modifiedFiles: [String]?
    var symbolsTouched: [String]?
    var decisions: [String]?

    /// Age as a human-readable string.
    var ageString: String {
        let ageMs = Date.now.timeIntervalSince1970 * 1000 - timestamp
        let minutes = Int(ageMs / 60_000)
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        return "\(hours / 24)d ago"
    }

    /// Whether the checkpoint is stale (> 7 days).
    var isStale: Bool {
        let ageMs = Date.now.timeIntervalSince1970 * 1000 - timestamp
        return ageMs > 7 * 24 * 60 * 60 * 1000
    }
}

/// A pending handoff written by `paradigm_handoff_prepare`.
struct HandoffSummary: Codable {
    let id: String
    let timestamp: String          // ISO 8601
    let from: String
    let to: String
    let summary: String
    let nextSteps: [String]
    let modifiedFiles: [String]
    let symbolsTouched: [String]
    let openQuestions: [String]
}

/// Reads checkpoint and handoff data for a given project path.
enum CheckpointReader {

    // MARK: - Local Checkpoint

    /// Read from .paradigm/session-checkpoint.json in the project root.
    static func readCheckpoint(projectPath: String) -> SessionCheckpoint? {
        let localPath = URL(fileURLWithPath: projectPath)
            .appendingPathComponent(".paradigm/session-checkpoint.json")

        if let checkpoint = decodeFile(SessionCheckpoint.self, at: localPath) {
            return checkpoint.isStale ? nil : checkpoint
        }

        // Fallback: global path ~/.paradigm/sessions/{hash}/checkpoint.json
        let globalDir = globalSessionDir(for: projectPath)
        let globalPath = globalDir.appendingPathComponent("checkpoint.json")

        if let checkpoint = decodeFile(SessionCheckpoint.self, at: globalPath) {
            return checkpoint.isStale ? nil : checkpoint
        }

        return nil
    }

    // MARK: - Handoffs

    /// Read all pending handoff files for a project.
    static func readHandoffs(projectPath: String) -> [HandoffSummary] {
        let globalDir = globalSessionDir(for: projectPath)
        let handoffsDir = globalDir.appendingPathComponent("pending-handoffs")

        let fm = FileManager.default
        guard fm.fileExists(atPath: handoffsDir.path) else { return [] }

        var handoffs: [HandoffSummary] = []
        guard let files = try? fm.contentsOfDirectory(atPath: handoffsDir.path) else { return [] }

        for file in files where file.hasSuffix(".json") {
            let filePath = handoffsDir.appendingPathComponent(file)
            if let handoff = decodeFile(HandoffSummary.self, at: filePath) {
                handoffs.append(handoff)
            }
        }

        return handoffs
    }

    // MARK: - Project Name

    /// Try to read the project name from .paradigm/config.yaml or fall back to dirname.
    static func projectName(for path: String) -> String {
        let configPath = URL(fileURLWithPath: path)
            .appendingPathComponent(".paradigm/config.yaml")

        if let content = try? String(contentsOf: configPath, encoding: .utf8) {
            // Simple YAML parse for "name: ..." line
            for line in content.components(separatedBy: "\n") {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("name:") {
                    let value = trimmed.dropFirst(5).trimmingCharacters(in: .whitespaces)
                    if !value.isEmpty { return value }
                }
            }
        }

        return URL(fileURLWithPath: path).lastPathComponent
    }

    // MARK: - Private

    /// Global session directory: ~/.paradigm/sessions/{sha256-prefix}/
    private static func globalSessionDir(for projectPath: String) -> URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let resolved = URL(fileURLWithPath: projectPath).standardized.path
        let hash = SHA256.hash(data: Data(resolved.utf8))
        let prefix = hash.prefix(8).map { String(format: "%02x", $0) }.joined()
        return home.appendingPathComponent(".paradigm/sessions/\(prefix)")
    }

    private static func decodeFile<T: Decodable>(_ type: T.Type, at url: URL) -> T? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
