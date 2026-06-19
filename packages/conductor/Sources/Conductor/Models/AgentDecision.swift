// AgentDecision.swift — #agent-decision
// A host-rendered branching CHOICE the agent offers the human, parsed from a
// ```conductor-decision fenced block in the assistant's TEXT (#fenced-block-parser).
// Answering a decision is a NORMAL user turn ($decision-exchange) — the host
// composes a human-readable reply from the chosen option(s) and sends it via the
// existing send(text:) path. ADDITIVE: lives on ConversationMessage alongside
// .text/.toolCalls and never touches the stream machinery (~session-isolation).

import Foundation

/// One selectable option within an AgentDecision.
struct DecisionOption: Identifiable, Sendable, Equatable {
    let id: String
    let label: String
    let description: String?
    /// Agent-recommended lean — rendered with a ★. Optional, off-schema-tolerant.
    let recommended: Bool
    /// Linked visual id (▸ "view") — opens the LIGHTBOX for that AgentVisual.
    let visualId: String?
    /// The real graph symbols (#component $flow ^gate !signal ~aspect) this option
    /// touches. Drives the hover-to-spotlight binding (option row → light up its
    /// symbols in the LIGHTBOX graph). Schema-tolerant — defaults to [].
    let affectedSymbols: [String]

    init(id: String, label: String, description: String? = nil, recommended: Bool = false, visualId: String? = nil, affectedSymbols: [String] = []) {
        self.id = id
        self.label = label
        self.description = description
        self.recommended = recommended
        self.visualId = visualId
        self.affectedSymbols = affectedSymbols
    }
}

/// The human's settled answer to an AgentDecision. Once set, a re-parse of the
/// accumulated text MUST preserve it (#fenced-block-parser merge rule) so a
/// later streaming chunk never wipes a chosen answer.
struct DecisionAnswer: Sendable, Equatable {
    /// The option id(s) the human chose (multi for multiSelect).
    let chosenOptionIds: [String]
    /// Free-text the human typed in the "Other…" escape, if any.
    let otherText: String?
    /// When the human settled it — drives the muted "✓ you chose …" collapse.
    let answeredAt: Date
}

/// A branching choice the agent offers the human. 2–5 options; pending = amber,
/// answered = settled teal/muted (Mika's temperature law).
struct AgentDecision: Identifiable, Sendable, Equatable {
    /// Stable identity: the explicit `id` from the JSON, else a (lang,ordinal)
    /// synthetic id assigned by the parser. Load-bearing for the preserve-answer
    /// merge across re-parses.
    let id: String
    let question: String
    let options: [DecisionOption]
    let multiSelect: Bool
    let allowOther: Bool
    /// The real graph symbols this whole decision is about (#component $flow ^gate
    /// !signal ~aspect). The agent tags a decision so the host can ground it in the
    /// live graph. Schema-tolerant — defaults to [].
    let symbols: [String]
    /// nil = pending (awaiting the human); non-nil = settled.
    var answer: DecisionAnswer?

    init(id: String, question: String, options: [DecisionOption], multiSelect: Bool, allowOther: Bool, symbols: [String] = [], answer: DecisionAnswer? = nil) {
        self.id = id
        self.question = question
        self.options = options
        self.multiSelect = multiSelect
        self.allowOther = allowOther
        self.symbols = symbols
        self.answer = answer
    }

    var isPending: Bool { answer == nil }

    /// Compose the human-readable user turn sent when the human answers. Mirrors
    /// Scholar's contract: "For '<question>' I chose: <labels>" or the free text.
    /// Pure/deterministic so AgentDecisionTests can assert it.
    func composeReply(optionIds: [String], otherText: String?) -> String {
        let trimmedOther = otherText?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let other = trimmedOther, !other.isEmpty, optionIds.isEmpty {
            return "For \u{201C}\(question)\u{201D} \u{2014} \(other)"
        }
        let labels = optionIds.compactMap { oid in
            options.first(where: { $0.id == oid })?.label
        }
        var picked = labels.joined(separator: ", ")
        if let other = trimmedOther, !other.isEmpty {
            picked += picked.isEmpty ? other : ", \(other)"
        }
        if picked.isEmpty { picked = optionIds.joined(separator: ", ") }
        return "For \u{201C}\(question)\u{201D} I chose: \(picked)"
    }
}
