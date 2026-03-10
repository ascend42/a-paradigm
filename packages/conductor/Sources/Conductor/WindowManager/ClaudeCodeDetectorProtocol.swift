// ClaudeCodeDetectorProtocol.swift — ~platform-abstracted
// Protocol for discovering Claude Code terminal instances.
// macOS: AXUIElement + CGWindowListCopyWindowInfo — Sprint 1
// Windows: EnumWindows + UI Automation API (future)

import Foundation

/// Platform-abstracted Claude Code instance detector.
/// Implementations scan running windows to find Claude Code sessions.
@MainActor
protocol ClaudeCodeDetectorProtocol {
    /// Perform a single scan and return all detected instances.
    func detectInstances() -> [ClaudeCodeInstance]

    /// Continuous stream of detected instance lists (polled at an interval).
    var instanceStream: AsyncStream<[ClaudeCodeInstance]> { get }

    /// Start polling for instances.
    func startPolling(interval: TimeInterval)

    /// Stop polling.
    func stopPolling()
}
