// ClaudeCodeDetector.swift — #window-detector
// Accessibility API-based Claude Code instance discovery.
// Uses AXUIElement to enumerate terminal windows and read titles.
// CGWindowListCopyWindowInfo is unreliable on modern macOS without Screen Recording permission.

import AppKit
import ApplicationServices

/// macOS implementation of Claude Code instance detection.
/// Uses Accessibility API to enumerate terminal windows and match Claude Code sessions.
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
        "com.todesktop.230313mzl4w4u92",  // Cursor terminal
    ]

    /// Title patterns that indicate Claude Code is running (case-insensitive).
    private static let claudeCodePatterns: [String] = [
        "claude",
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
        var detected: [ClaudeCodeInstance] = []

        // Strategy: enumerate running terminal apps via NSWorkspace,
        // then use AXUIElement to read each window's title.
        let runningApps = NSWorkspace.shared.runningApplications

        for app in runningApps {
            guard let bundleID = app.bundleIdentifier else { continue }

            // Check if this is a known terminal
            let isTerminal = Self.terminalBundleIDs.contains(bundleID) ||
                             app.localizedName?.lowercased().contains("terminal") == true

            guard isTerminal else { continue }

            // Use AXUIElement to get this app's windows
            let axApp = AXUIElementCreateApplication(app.processIdentifier)
            var windowsRef: AnyObject?
            let result = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsRef)

            guard result == .success, let windows = windowsRef as? [AXUIElement] else {
                continue
            }

            for (index, window) in windows.enumerated() {
                // Read window title via AX
                var titleRef: AnyObject?
                AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleRef)
                let title = titleRef as? String ?? ""

                // Read window position and size via AX
                let frame = axWindowFrame(window)

                // Check if this window is running Claude Code
                let lowerTitle = title.lowercased()
                let isClaudeCode = Self.claudeCodePatterns.contains { lowerTitle.contains($0) }

                guard isClaudeCode else { continue }

                let instanceID = "cc-\(app.processIdentifier)-\(index)"

                let instance = ClaudeCodeInstance(
                    id: instanceID,
                    windowID: CGWindowID(app.processIdentifier),
                    processID: app.processIdentifier,
                    title: title.isEmpty ? (app.localizedName ?? bundleID) : title,
                    projectDirectory: extractProjectDir(from: title),
                    frame: frame
                )

                detected.append(instance)
            }
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

    /// Read a window's frame via AXUIElement position + size attributes.
    private func axWindowFrame(_ window: AXUIElement) -> CGRect {
        var posRef: AnyObject?
        var sizeRef: AnyObject?
        AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &posRef)
        AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeRef)

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

    /// Try to extract the project directory from a terminal window title.
    private func extractProjectDir(from title: String) -> String? {
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
