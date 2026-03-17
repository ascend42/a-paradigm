// TaskArchive.swift — #task-archive
// Archive storage for completed/failed tasks. Uses JSONL format matching ScoreIO pattern.

import Foundation

// MARK: - Archive Entry

struct TaskArchiveEntry: Codable {
    let record: TaskRecord
    let archivedAt: Date
}

// MARK: - Archive IO

enum TaskArchiveIO {

    static let archivePath: URL = {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".paradigm/conductor/tasks-archive.jsonl")
    }()

    /// Append task records to the archive JSONL file.
    static func archive(_ records: [TaskRecord]) {
        let fm = FileManager.default
        let dir = archivePath.deletingLastPathComponent()
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601

        var lines: [String] = []
        for record in records {
            let entry = TaskArchiveEntry(record: record, archivedAt: .now)
            if let data = try? encoder.encode(entry),
               let line = String(data: data, encoding: .utf8) {
                lines.append(line)
            }
        }

        guard !lines.isEmpty else { return }
        let text = lines.joined(separator: "\n") + "\n"

        if fm.fileExists(atPath: archivePath.path) {
            if let handle = try? FileHandle(forWritingTo: archivePath) {
                handle.seekToEndOfFile()
                if let data = text.data(using: .utf8) {
                    handle.write(data)
                }
                handle.closeFile()
            }
        } else {
            try? text.write(to: archivePath, atomically: true, encoding: .utf8)
        }
    }

    /// Load all archived entries from JSONL.
    static func loadArchive() -> [TaskArchiveEntry] {
        let fm = FileManager.default
        guard fm.fileExists(atPath: archivePath.path),
              let content = try? String(contentsOf: archivePath, encoding: .utf8) else {
            return []
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        return content.components(separatedBy: "\n").compactMap { line in
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty,
                  let data = trimmed.data(using: .utf8) else { return nil }
            return try? decoder.decode(TaskArchiveEntry.self, from: data)
        }
    }

    /// Fast line count without decoding.
    static func archiveCount() -> Int {
        let fm = FileManager.default
        guard fm.fileExists(atPath: archivePath.path),
              let content = try? String(contentsOf: archivePath, encoding: .utf8) else {
            return 0
        }
        return content.components(separatedBy: "\n")
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .count
    }
}
