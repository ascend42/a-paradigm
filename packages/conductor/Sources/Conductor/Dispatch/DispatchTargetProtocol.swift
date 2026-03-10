// DispatchTargetProtocol.swift — ~platform-abstracted
// Protocol for sending text to a Claude Code window.
// macOS: AX setValue / clipboard + Cmd+V via CGEvent — Sprint 1
// Windows: UIA ValuePattern.SetValue / clipboard + Ctrl+V (future)

import Foundation

/// Platform-abstracted text dispatch to a Claude Code instance.
/// Implementations inject text into the target terminal's input field.
protocol DispatchTargetProtocol {
    /// Send text to a specific Claude Code instance.
    /// - Parameters:
    ///   - text: The text to inject.
    ///   - instance: The target Claude Code instance.
    ///   - submit: Whether to also press Enter/Return after injecting.
    func sendText(_ text: String, to instance: ClaudeCodeInstance, submit: Bool) async throws
}

/// Errors that can occur during text dispatch.
enum DispatchError: Error, LocalizedError {
    case instanceNotFound
    case accessibilityDenied
    case textInjectionFailed(String)
    case clipboardFallbackFailed

    var errorDescription: String? {
        switch self {
        case .instanceNotFound:
            return "Target Claude Code instance is no longer available"
        case .accessibilityDenied:
            return "Accessibility permission is required to send text to windows"
        case .textInjectionFailed(let detail):
            return "Failed to inject text: \(detail)"
        case .clipboardFallbackFailed:
            return "Clipboard-based text injection also failed"
        }
    }
}
