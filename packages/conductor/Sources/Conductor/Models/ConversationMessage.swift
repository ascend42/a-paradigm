// ConversationMessage.swift — #conversation-model
// The observable projection of the stream-json event sequence into a renderable
// conversation. Decoupled from the wire format (StreamEvent) so the UI only ever
// sees this shape.

import Foundation

/// Who authored a conversation message.
enum MessageAuthor: Sendable {
    case agent
    case user
    case system
}

/// Lifecycle state of a tool call chip.
enum ToolCallState: Sendable {
    case running
    case succeeded
    case failed
}

/// A single tool invocation surfaced in the thread as a chip.
/// `id` is the `tool_use` id, used to match the later `tool_result`.
struct ToolCall: Identifiable, Sendable {
    let id: String
    let name: String
    let inputSummary: String
    var state: ToolCallState
    var resultSummary: String?
}

/// A renderable conversation message — one agent turn (which may grow tool calls
/// over its lifetime), a user turn, or a system note.
struct ConversationMessage: Identifiable, Sendable {
    let id: UUID
    let author: MessageAuthor
    var text: String
    var toolCalls: [ToolCall]
    var isStreaming: Bool
    /// A host→agent CONTROL message that must NOT be rendered in the thread
    /// (#atrium-shells). Used for the suppressed, authoritative TaskStop turn that
    /// kills a background shell (the Claude Code 2.1.x kill tool). The turn is still
    /// written to claude's stdin so the agent acts on it, but AtriumThreadView
    /// filters it out of the visible conversation so it never clutters the thread.
    var isControl: Bool
    /// Host-rendered branching CHOICES parsed from ```conductor-decision fenced
    /// blocks in this turn's text (#agent-decision / #fenced-block-parser). ADDITIVE,
    /// defaults []. Re-parse PRESERVES any settled .answer ($decision-exchange).
    var decisions: [AgentDecision]
    /// Host-rendered DIAGRAMS/COMPARISONS parsed from ```conductor-visual / ```mermaid
    /// fenced blocks (#agent-visual). ADDITIVE, defaults []. Rendered as a ▸ launcher
    /// chip; clicking opens the LIGHTBOX (#atrium-visual-canvas) — never auto-opens.
    var visuals: [AgentVisual]

    init(
        id: UUID = UUID(),
        author: MessageAuthor,
        text: String = "",
        toolCalls: [ToolCall] = [],
        isStreaming: Bool = false,
        isControl: Bool = false,
        decisions: [AgentDecision] = [],
        visuals: [AgentVisual] = []
    ) {
        self.id = id
        self.author = author
        self.text = text
        self.toolCalls = toolCalls
        self.isStreaming = isStreaming
        self.isControl = isControl
        self.decisions = decisions
        self.visuals = visuals
    }
}
