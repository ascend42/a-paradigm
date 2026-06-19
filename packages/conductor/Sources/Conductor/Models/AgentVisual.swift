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
    case graph       // symbol ego-graph → native SwiftUI Canvas (AtriumGraphView)
    case wireframe   // v2
    case diff        // v2
}

// MARK: - Graph slice payload (kind == .graph)

/// The classification of a graph node, decoded from the projector envelope's
/// `node.kind` string. Falls back to the symbol-id prefix when absent/unknown.
enum GraphSymbolKind: String, Sendable, Equatable {
    case component
    case flow
    case gate
    case signal
    case aspect

    /// Decode from the envelope `node.kind` string, falling back to the id prefix.
    /// Prefix map: `#`→component, `$`/`$$`→flow, `^`→gate, `!`→signal, `~`→aspect.
    static func decode(kindString: String?, id: String) -> GraphSymbolKind {
        if let raw = kindString?.lowercased(), let k = GraphSymbolKind(rawValue: raw) {
            return k
        }
        // `$$` (double) and `$` both mean flow — inspect the first scalar.
        switch id.first {
        case "#": return .component
        case "$": return .flow
        case "^": return .gate
        case "!": return .signal
        case "~": return .aspect
        default: return .component
        }
    }
}

/// The relationship an edge represents in the slice.
enum GraphEdgeKind: String, Sendable, Equatable {
    case uses
    case usedBy
    case inFlow
    case gatedBy

    /// Decode from the envelope `edge.kind` string (hyphenated forms tolerated).
    static func decode(_ raw: String?) -> GraphEdgeKind {
        switch (raw ?? "").lowercased() {
        case "uses": return .uses
        case "used-by", "usedby": return .usedBy
        case "in-flow", "inflow": return .inFlow
        case "gated-by", "gatedby": return .gatedBy
        default: return .uses
        }
    }
}

/// One node in a bounded ego-graph slice.
struct GraphNode: Identifiable, Sendable, Equatable {
    /// The symbol id (e.g. `#agent-decision`) — also the stable identity.
    let id: String
    let kind: GraphSymbolKind
    let label: String
    /// Absolute path to the defining `.purpose` (kept for later hover-binding; not
    /// used by the static render).
    let path: String?
}

/// One directed edge between two symbol ids.
struct GraphEdge: Sendable, Equatable {
    let source: String
    let target: String
    let kind: GraphEdgeKind
}

/// A bounded symbol ego-graph (kind == .graph). `root` is the focus node id; it is
/// also present in `nodes`. The render draws root at center and the rest on a ring.
struct GraphPayload: Sendable, Equatable {
    let root: String
    let nodes: [GraphNode]
    let edges: [GraphEdge]
    let truncated: Bool
    /// ISO-8601 timestamp from `freshness.generatedAt` (optional).
    let generatedAt: String?
    /// `freshness.stale` — the index was stale when this slice was cut.
    let stale: Bool
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
    /// Graph slice payload (kind == .graph).
    let graph: GraphPayload?
    /// The raw inner block text — kept for the v2 kinds + diagnostics.
    let raw: String

    /// Short label for the ▸ launcher chip.
    var chipLabel: String {
        if let title, !title.isEmpty { return title }
        switch kind {
        case .flow: return "diagram"
        case .comparison: return "comparison"
        case .graph: return "graph"
        case .wireframe: return "wireframe"
        case .diff: return "diff"
        }
    }

    /// True for kinds the v1 LIGHTBOX can actually render.
    var isRenderable: Bool { kind == .flow || kind == .comparison || kind == .graph }
}
