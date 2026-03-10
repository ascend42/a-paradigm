// EnrichedPayload.swift — #conductor-models
// Context-enriched dispatch payload.

import Foundation

/// The final payload dispatched to a Claude Code instance.
/// Contains the user's text plus optional Paradigm context.
struct EnrichedPayload {
    /// The raw text from the buffer (user input).
    let text: String

    /// Paradigm project status summary, if available.
    var paradigmStatus: String?

    /// Relevant symbol matches from paradigm_search.
    var relevantSymbols: [String]?

    /// Recent git diff summary for the target project.
    var gitDiffSummary: String?

    /// History context from paradigm_history_context.
    var historyContext: String?

    /// Whether context enrichment was applied.
    var isEnriched: Bool {
        paradigmStatus != nil || relevantSymbols != nil ||
        gitDiffSummary != nil || historyContext != nil
    }

    /// Assemble the final text to dispatch.
    func assembledText() -> String {
        guard isEnriched else { return text }

        var parts = [text, ""]

        if let status = paradigmStatus {
            parts.append("<!-- Paradigm Context -->")
            parts.append(status)
        }

        if let symbols = relevantSymbols, !symbols.isEmpty {
            parts.append("Relevant symbols: \(symbols.joined(separator: ", "))")
        }

        if let diff = gitDiffSummary {
            parts.append("Recent changes: \(diff)")
        }

        return parts.joined(separator: "\n")
    }
}
