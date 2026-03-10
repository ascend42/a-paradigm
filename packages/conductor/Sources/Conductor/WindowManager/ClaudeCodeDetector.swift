// ClaudeCodeDetector.swift — #window-detector
// AXUIElement + CGWindowListCopyWindowInfo implementation for detecting Claude Code instances.

import AppKit
import ApplicationServices

/// macOS implementation of Claude Code instance detection.
/// Polls running windows to find terminals running Claude Code.
@MainActor
final class ClaudeCodeDetector: ObservableObject, ClaudeCodeDetectorProtocol {
    /// Currently detected instances.
    @Published private(set) var instances: [ClaudeCodeInstance] = []

    private var pollTimer: Timer?
    private var instanceContinuation: AsyncStream<[ClaudeCodeInstance]>.Continuation?

    /// Known terminal bundle IDs that can host Claude Code.
    private static let terminalBundleIDs: Set<String> = [
        "com.apple.Terminal",
        "com.googlecode.iterm2",
        "co.zeit.hyper",
        "com.github.wez.wezterm",
        "dev.warp.Warp-Stable",
        "com.mitchellh.ghostty",
        "net.kovidgoyal.kitty",
        "io.alacritty",
    ]

    /// Title patterns that indicate Claude Code is running.
    private static let claudeCodePatterns: [String] = [
        "claude",
        "Claude Code",
        "claude-code",
        "anthropic",
    ]

    // MARK: - ClaudeCodeDetectorProtocol

    var instanceStream: AsyncStream<[ClaudeCodeInstance]> {
        AsyncStream { [weak self] continuation in
            Task { @MainActor in
                self?.instanceContinuation = continuation
            }
        }
    }

    func detectInstances() -> [ClaudeCodeInstance] {
        // This performs a synchronous scan — called from the protocol
        var detected: [ClaudeCodeInstance] = []

        guard let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return detected
        }

        for window in windowList {
            guard let windowID = window[kCGWindowNumber as String] as? CGWindowID,
                  let ownerPID = window[kCGWindowOwnerPID as String] as? pid_t,
                  let ownerName = window[kCGWindowOwnerName as String] as? String,
                  let boundsDict = window[kCGWindowBounds as String] as? [String: CGFloat],
                  let title = window[kCGWindowName as String] as? String else {
                continue
            }

            // Check if this is a terminal window
            let bundleID = NSRunningApplication(processIdentifier: ownerPID)?.bundleIdentifier ?? ""
            let isTerminal = Self.terminalBundleIDs.contains(bundleID) ||
                             ownerName.lowercased().contains("terminal")

            guard isTerminal else { continue }

            // Check if the title suggests Claude Code
            let lowerTitle = title.lowercased()
            let isClaudeCode = Self.claudeCodePatterns.contains { lowerTitle.contains($0.lowercased()) }

            guard isClaudeCode else { continue }

            let frame = CGRect(
                x: boundsDict["X"] ?? 0,
                y: boundsDict["Y"] ?? 0,
                width: boundsDict["Width"] ?? 800,
                height: boundsDict["Height"] ?? 600
            )

            let instance = ClaudeCodeInstance(
                id: "cc-\(windowID)",
                windowID: windowID,
                processID: ownerPID,
                title: title,
                projectDirectory: extractProjectDir(from: title),
                frame: frame
            )

            detected.append(instance)
        }

        return detected
    }

    func startPolling(interval: TimeInterval = 2.0) {
        stopPolling()
        ConductorLog.component("window-detector").info("Starting polling (interval: \(interval)s)")

        // Initial scan
        refreshInstances()

        pollTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refreshInstances()
            }
        }
    }

    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    // MARK: - Private

    private func refreshInstances() {
        let previous = Set(instances.map(\.id))
        let detected = detectInstances()
        let current = Set(detected.map(\.id))

        // Emit signals for new/lost instances
        for instance in detected where !previous.contains(instance.id) {
            ConductorLog.signal("instance-detected")
                .info("New CC instance: \(instance.title)")
        }
        for instance in instances where !current.contains(instance.id) {
            ConductorLog.signal("instance-lost")
                .info("Lost CC instance: \(instance.title)")
        }

        instances = detected
        instanceContinuation?.yield(detected)
    }

    /// Try to extract the project directory from a terminal window title.
    /// Many terminals show the cwd in the title (e.g., "~/Projects/my-app — claude").
    private func extractProjectDir(from title: String) -> String? {
        // Common patterns:
        // "user@host:~/path — claude"
        // "~/path (claude)"
        // "/Users/name/path"
        let components = title.components(separatedBy: CharacterSet(charactersIn: "—–-:|"))
        for component in components {
            let trimmed = component.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("~") || trimmed.hasPrefix("/") {
                return trimmed
            }
        }
        return nil
    }
}
