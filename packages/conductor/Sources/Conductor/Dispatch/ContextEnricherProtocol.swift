// ContextEnricherProtocol.swift — ~platform-abstracted
// Protocol for enriching dispatched text with Paradigm context.
// Implementation: paradigm-mcp stdio + git diff — Sprint 5

import Foundation

/// Platform-abstracted context enrichment.
/// Implementations call paradigm-mcp and git to assemble context for dispatch.
protocol ContextEnricherProtocol {
    /// Enrich text with Paradigm context for a given project directory.
    func enrich(_ text: String, for projectDir: String) async -> EnrichedPayload

    /// Whether context enrichment is available (MCP reachable, git present).
    var isAvailable: Bool { get }

    /// Enable or disable enrichment globally.
    var isEnabled: Bool { get set }
}
