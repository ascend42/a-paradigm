// AgentVisual.swift — #agent-visual
// A host-rendered DIAGRAM or COMPARISON the agent emits, parsed from a
// ```conductor-visual fenced block (envelope, kind flow|comparison for v1) OR a
// bare ```mermaid fence in the assistant's TEXT (#fenced-block-parser). The thread
// shows a ▸ launcher chip; clicking opens the LIGHTBOX (#atrium-visual-canvas).
// ADDITIVE — lives on ConversationMessage, never auto-opens.
//
// v2 kinds (wireframe, diff) are decoded-tolerant here but flagged not-rendered.

import Foundation

/// The shape of an AgentVisual. flow + comparison render in v1; wireframe + diff
/// are reserved for v2 (decoded but the canvas renders a "coming in v2" placeholder).
enum VisualKind: String, Sendable, Equatable {
    case flow        // mermaid diagram → MermaidWebView
    case comparison  // columns/rows → native SwiftUI table
    case wireframe   // v2
    case diff        // v2
}

/// One row of a comparison table.
struct ComparisonRow: Identifiable, Sendable, Equatable {
    let id = UUID()
    let label: String
    let cells: [String]
}

/// A comparison table payload (kind == .comparison).
struct ComparisonTable: Sendable, Equatable {
    let columns: [String]
    let rows: [ComparisonRow]
}

/// A host-rendered visual. Carries exactly the payload its `kind` needs.
struct AgentVisual: Identifiable, Sendable, Equatable {
    /// Stable identity: explicit JSON `id`, else synthetic (lang,ordinal). A
    /// DecisionOption.visualId references this.
    let id: String
    let kind: VisualKind
    let title: String?
    /// Mermaid source (kind == .flow).
    let mermaid: String?
    /// Comparison payload (kind == .comparison).
    let comparison: ComparisonTable?
    /// The raw inner block text — kept for the v2 kinds + diagnostics.
    let raw: String

    /// Short label for the ▸ launcher chip.
    var chipLabel: String {
        if let title, !title.isEmpty { return title }
        switch kind {
        case .flow: return "diagram"
        case .comparison: return "comparison"
        case .wireframe: return "wireframe"
        case .diff: return "diff"
        }
    }

    /// True for kinds the v1 LIGHTBOX can actually render.
    var isRenderable: Bool { kind == .flow || kind == .comparison }
}
