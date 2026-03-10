// SessionFileWatcher.swift — #session-file-watcher
// Watches ~/.conductor/sessions/ for registration files written by Claude Code.
// Merges file-registered sessions with AX-detected instances.

import AppKit
import Foundation

/// A session registration written by `paradigm_conductor_register`.
struct RegisteredSession: Codable, Equatable {
    let pid: Int
    let parentPid: Int?
    let projectDir: String
    let terminal: String?
    let label: String?
    let branch: String?
    let registeredAt: String
}

/// Watches ~/.conductor/sessions/ for JSON registration files.
@MainActor
final class SessionFileWatcher: ObservableObject {
    /// Currently registered sessions (from files).
    @Published private(set) var registeredSessions: [RegisteredSession] = []

    /// Instances synthesized from registration files.
    @Published private(set) var registeredInstances: [ClaudeCodeInstance] = []

    private let sessionsDir: URL
    private var pollTimer: Timer?
    private var fileDescriptor: CInt = -1
    private var dispatchSource: DispatchSourceFileSystemObject?

    init() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        sessionsDir = home.appendingPathComponent(".conductor/sessions")

        // Ensure directory exists
        try? FileManager.default.createDirectory(
            at: sessionsDir,
            withIntermediateDirectories: true
        )
    }

    nonisolated deinit {
        // Cleanup handled by stopWatching() called from onDisappear
    }

    // MARK: - Public

    func startWatching() {
        let dir = sessionsDir
        ConductorLog.component("session-file-watcher").info("Watching \(dir.path)")

        // Initial scan
        refresh()

        // Use dispatch source on the directory for near-instant detection
        startDirectoryWatch()

        // Also poll every 5s as a fallback (dispatch sources can miss events)
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refresh()
            }
        }
    }

    func stopWatching() {
        pollTimer?.invalidate()
        pollTimer = nil
        dispatchSource?.cancel()
        dispatchSource = nil
        if fileDescriptor >= 0 {
            close(fileDescriptor)
            fileDescriptor = -1
        }
    }

    // MARK: - Private

    private func startDirectoryWatch() {
        fileDescriptor = Darwin.open(sessionsDir.path, O_EVTONLY)
        guard fileDescriptor >= 0 else {
            ConductorLog.component("session-file-watcher")
                .info("Cannot open directory for monitoring, using poll-only mode")
            return
        }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fileDescriptor,
            eventMask: [.write, .delete, .rename],
            queue: .main
        )

        source.setEventHandler { [weak self] in
            Task { @MainActor in
                self?.refresh()
            }
        }

        source.setCancelHandler { [weak self] in
            if let fd = self?.fileDescriptor, fd >= 0 {
                close(fd)
                self?.fileDescriptor = -1
            }
        }

        source.resume()
        dispatchSource = source
    }

    private func refresh() {
        let fm = FileManager.default

        guard fm.fileExists(atPath: sessionsDir.path) else {
            if !registeredSessions.isEmpty {
                registeredSessions = []
                registeredInstances = []
            }
            return
        }

        let files: [URL]
        do {
            files = try fm.contentsOfDirectory(
                at: sessionsDir,
                includingPropertiesForKeys: nil,
                options: .skipsHiddenFiles
            ).filter { $0.pathExtension == "json" }
        } catch {
            ConductorLog.component("session-file-watcher")
                .info("Failed to list sessions dir: \(error.localizedDescription)")
            return
        }

        var sessions: [RegisteredSession] = []
        var staleFiles: [URL] = []

        for file in files {
            guard let data = try? Data(contentsOf: file),
                  let session = try? JSONDecoder().decode(RegisteredSession.self, from: data) else {
                continue
            }

            // Check if the process is still alive
            if isProcessAlive(pid: session.pid) {
                sessions.append(session)
            } else {
                staleFiles.append(file)
            }
        }

        // Clean up stale files
        for staleFile in staleFiles {
            try? fm.removeItem(at: staleFile)
            ConductorLog.component("session-file-watcher")
                .info("Cleaned stale session: \(staleFile.lastPathComponent)")
        }

        // Only update if changed
        if sessions != registeredSessions {
            let previous = Set(registeredSessions.map(\.pid))

            for session in sessions where !previous.contains(session.pid) {
                ConductorLog.signal("instance-detected")
                    .info("Registered session: PID \(session.pid) — \(session.projectDir)")
            }
            for session in registeredSessions where !sessions.contains(where: { $0.pid == session.pid }) {
                ConductorLog.signal("instance-lost")
                    .info("Unregistered session: PID \(session.pid)")
            }

            registeredSessions = sessions
            registeredInstances = sessions.map(instanceFromSession)
        }
    }

    /// Convert a registered session into a ClaudeCodeInstance.
    private func instanceFromSession(_ session: RegisteredSession) -> ClaudeCodeInstance {
        let label = session.label ?? session.branch ?? URL(fileURLWithPath: session.projectDir).lastPathComponent
        let title = "[\(label)] \(session.projectDir)"

        // Try to find the terminal process to get its actual PID for window matching
        let terminalPid: pid_t
        if let parentPid = session.parentPid {
            terminalPid = pid_t(parentPid)
        } else {
            terminalPid = pid_t(session.pid)
        }

        return ClaudeCodeInstance(
            id: "reg-\(session.pid)",
            windowID: CGWindowID(0), // Not from AX — no window ID
            processID: terminalPid,
            title: title,
            projectDirectory: session.projectDir,
            frame: findWindowFrame(forPid: terminalPid)
        )
    }

    /// Try to find the window frame for a PID using AXUIElement.
    private func findWindowFrame(forPid pid: pid_t) -> CGRect {
        let axApp = AXUIElementCreateApplication(pid)
        var windowsRef: AnyObject?
        let result = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsRef)

        guard result == .success,
              let windows = windowsRef as? [AXUIElement],
              let firstWindow = windows.first else {
            return CGRect(x: 0, y: 0, width: 800, height: 600)
        }

        var posRef: AnyObject?
        var sizeRef: AnyObject?
        AXUIElementCopyAttributeValue(firstWindow, kAXPositionAttribute as CFString, &posRef)
        AXUIElementCopyAttributeValue(firstWindow, kAXSizeAttribute as CFString, &sizeRef)

        var position = CGPoint.zero
        var size = CGSize(width: 800, height: 600)

        if let posValue = posRef {
            AXValueGetValue(posValue as! AXValue, .cgPoint, &position)
        }
        if let sizeValue = sizeRef {
            AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
        }

        return CGRect(origin: position, size: size)
    }

    /// Check if a process is still running.
    private func isProcessAlive(pid: Int) -> Bool {
        kill(Int32(pid), 0) == 0
    }
}
