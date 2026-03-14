// ScoreIO.swift — #score-io
// JSONL read/write + directory management at ~/.paradigm/score/.
// Byte-compatible with Node.js JSON.stringify output.

import Foundation

/// File-system I/O for The Score — JSONL read/write and directory management.
/// All paths rooted at ~/.paradigm/score/.
@MainActor
enum ScoreIO {

    // MARK: - Directory Constants

    private static let home = FileManager.default.homeDirectoryForCurrentUser

    static let scoreDir = home.appendingPathComponent(".paradigm/score")
    static let agentsDir = scoreDir.appendingPathComponent("agents")
    static let threadsDir = scoreDir.appendingPathComponent("threads")
    static let fileRequestsDir = scoreDir.appendingPathComponent("file-requests")
    static let trustConfigPath = scoreDir.appendingPathComponent("trust.yaml")

    /// Legacy mail directory for auto-migration.
    private static let legacyMailDir = home.appendingPathComponent(".paradigm/mail")

    // MARK: - Shared Encoder/Decoder

    /// Encoder configured for Node.js JSON.stringify compatibility.
    /// No pretty print — single-line compact JSON per JSONL convention.
    static let encoder: JSONEncoder = {
        let enc = JSONEncoder()
        enc.outputFormatting = []
        return enc
    }()

    static let decoder = JSONDecoder()

    // MARK: - Directory Management

    /// Create score directories if missing. Auto-migrates from legacy ~/.paradigm/mail/ if present.
    static func ensureScoreDirs() {
        let fm = FileManager.default

        // Auto-migrate from legacy mail directory
        if fm.fileExists(atPath: legacyMailDir.path) && !fm.fileExists(atPath: scoreDir.path) {
            do {
                try fm.moveItem(at: legacyMailDir, to: scoreDir)
                ConductorLog.component("score-io").info("Migrated legacy mail dir to score dir")
            } catch {
                ConductorLog.component("score-io")
                    .info("Failed to migrate legacy mail dir: \(error.localizedDescription)")
            }
        }

        for dir in [agentsDir, threadsDir, fileRequestsDir] {
            if !fm.fileExists(atPath: dir.path) {
                do {
                    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
                } catch {
                    ConductorLog.component("score-io")
                        .info("Failed to create dir \(dir.path): \(error.localizedDescription)")
                }
            }
        }
    }

    // MARK: - JSONL Read/Write

    /// Read a JSONL file, decoding each line. Skips malformed lines.
    static func readJsonl<T: Decodable>(at path: URL) -> [T] {
        let fm = FileManager.default
        guard fm.fileExists(atPath: path.path) else { return [] }

        guard let content = try? String(contentsOf: path, encoding: .utf8) else {
            ConductorLog.component("score-io").info("Failed to read JSONL at \(path.path)")
            return []
        }

        let lines = content.components(separatedBy: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        var items: [T] = []

        for line in lines {
            guard let data = line.data(using: .utf8) else { continue }
            do {
                let item = try decoder.decode(T.self, from: data)
                items.append(item)
            } catch {
                // Skip malformed lines — same behavior as TypeScript
            }
        }

        return items
    }

    /// Append a single JSON-encoded item as a new line in a JSONL file.
    static func appendJsonl<T: Encodable>(_ item: T, to path: URL) {
        let fm = FileManager.default

        // Ensure parent directory exists
        let dir = path.deletingLastPathComponent()
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }

        do {
            let data = try encoder.encode(item)
            guard var jsonString = String(data: data, encoding: .utf8) else { return }
            jsonString += "\n"

            if fm.fileExists(atPath: path.path) {
                guard let fileHandle = try? FileHandle(forWritingTo: path) else {
                    ConductorLog.component("score-io").info("Failed to open \(path.path) for append")
                    return
                }
                defer { try? fileHandle.close() }
                fileHandle.seekToEndOfFile()
                if let lineData = jsonString.data(using: .utf8) {
                    fileHandle.write(lineData)
                }
            } else {
                try jsonString.write(to: path, atomically: true, encoding: .utf8)
            }
        } catch {
            ConductorLog.component("score-io")
                .info("Failed to append JSONL to \(path.path): \(error.localizedDescription)")
        }
    }

    /// Write a single JSON file (for identity, ack, thread, file-request records).
    static func writeJson<T: Encodable>(_ item: T, to path: URL, prettyPrint: Bool = true) {
        do {
            let enc = JSONEncoder()
            enc.outputFormatting = prettyPrint ? [.prettyPrinted, .sortedKeys] : []
            let data = try enc.encode(item)
            try data.write(to: path, options: .atomic)
        } catch {
            ConductorLog.component("score-io")
                .info("Failed to write JSON to \(path.path): \(error.localizedDescription)")
        }
    }

    /// Read a single JSON file.
    static func readJson<T: Decodable>(at path: URL) -> T? {
        guard FileManager.default.fileExists(atPath: path.path) else { return nil }

        do {
            let data = try Data(contentsOf: path)
            return try decoder.decode(T.self, from: data)
        } catch {
            ConductorLog.component("score-io")
                .info("Failed to read JSON at \(path.path): \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: - Agent Path Helpers

    /// Directory for a specific agent (agentId format: "{project}/{role}").
    static func agentDir(for agentId: String) -> URL {
        agentsDir.appendingPathComponent(agentId)
    }

    /// Inbox JSONL path for a specific agent.
    static func inboxPath(for agentId: String) -> URL {
        agentDir(for: agentId).appendingPathComponent("inbox.jsonl")
    }

    /// Outbox JSONL path for a specific agent.
    static func outboxPath(for agentId: String) -> URL {
        agentDir(for: agentId).appendingPathComponent("outbox.jsonl")
    }

    /// Ack JSON path for a specific agent.
    static func ackPath(for agentId: String) -> URL {
        agentDir(for: agentId).appendingPathComponent("ack.json")
    }

    /// Identity JSON path for a specific agent.
    static func identityPath(for agentId: String) -> URL {
        agentDir(for: agentId).appendingPathComponent("identity.json")
    }

    // MARK: - Thread/File-Request Path Helpers

    /// Path for a thread metadata file.
    static func threadPath(for threadId: String) -> URL {
        threadsDir.appendingPathComponent("\(threadId).json")
    }

    /// Path for a file request record.
    static func fileRequestPath(for requestId: String) -> URL {
        fileRequestsDir.appendingPathComponent("\(requestId).json")
    }
}
