// GitMonitor.swift — #git-monitor
// Polls git diff for project context.

import Foundation

/// Monitors git status for a project directory.
/// Provides recent diff summaries for context enrichment.
@MainActor
final class GitMonitor: ObservableObject {
    let projectDirectory: String

    @Published private(set) var lastDiffSummary: String?
    @Published private(set) var isGitRepo: Bool = false

    private var pollTimer: Timer?

    /// Cache TTL in seconds.
    var cacheTTL: TimeInterval = 10.0

    private var lastPollTime: Date = .distantPast

    init(projectDirectory: String) {
        self.projectDirectory = projectDirectory
    }

    // MARK: - Polling

    func startPolling(interval: TimeInterval = 10.0) {
        stopPolling()
        isGitRepo = checkIsGitRepo()

        let dir = projectDirectory
        guard isGitRepo else {
            ConductorLog.component("git-monitor").info("Not a git repo: \(dir)")
            return
        }

        refresh()

        pollTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refresh()
            }
        }

        ConductorLog.component("git-monitor").info("Monitoring git at \(dir)")
    }

    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    func refresh() {
        let now = Date()
        guard now.timeIntervalSince(lastPollTime) >= cacheTTL else { return }
        lastPollTime = now

        Task.detached { [projectDirectory] in
            let summary = Self.runGitDiffStat(in: projectDirectory)
            await MainActor.run { [weak self] in
                self?.lastDiffSummary = summary
            }
        }
    }

    // MARK: - Git Operations

    private nonisolated func checkIsGitRepo() -> Bool {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        proc.arguments = ["rev-parse", "--is-inside-work-tree"]
        proc.currentDirectoryURL = URL(fileURLWithPath: projectDirectory)
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try? proc.run()
        proc.waitUntilExit()
        return proc.terminationStatus == 0
    }

    private nonisolated static func runGitDiffStat(in directory: String) -> String? {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        proc.arguments = ["diff", "--stat"]
        proc.currentDirectoryURL = URL(fileURLWithPath: directory)

        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = FileHandle.nullDevice

        try? proc.run()
        proc.waitUntilExit()

        guard proc.terminationStatus == 0 else { return nil }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return output?.isEmpty == true ? nil : output
    }
}
