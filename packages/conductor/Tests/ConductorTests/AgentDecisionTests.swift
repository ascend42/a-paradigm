// AgentDecisionTests.swift
// Tests for #agent-decision — reply-string composition + pending→answered settle,
// plus the preserve-answer merge contract relied on by the stream re-parse.

import XCTest
@testable import Conductor

final class AgentDecisionTests: XCTestCase {

    private func makeDecision(multiSelect: Bool = false) -> AgentDecision {
        AgentDecision(
            id: "deploy",
            question: "Where should this deploy?",
            options: [
                DecisionOption(id: "staging", label: "Staging"),
                DecisionOption(id: "prod", label: "Production"),
                DecisionOption(id: "canary", label: "Canary 5%"),
            ],
            multiSelect: multiSelect,
            allowOther: true,
            answer: nil
        )
    }

    // MARK: - Reply composition

    func testComposeReplySingleChoice() {
        let d = makeDecision()
        let reply = d.composeReply(optionIds: ["prod"], otherText: nil)
        XCTAssertTrue(reply.contains("Where should this deploy?"))
        XCTAssertTrue(reply.contains("I chose"))
        XCTAssertTrue(reply.contains("Production"))
    }

    func testComposeReplyMultiChoiceJoinsLabels() {
        let d = makeDecision(multiSelect: true)
        let reply = d.composeReply(optionIds: ["staging", "canary"], otherText: nil)
        XCTAssertTrue(reply.contains("Staging"))
        XCTAssertTrue(reply.contains("Canary 5%"))
        XCTAssertTrue(reply.contains(","), "multiple labels joined with a comma")
    }

    func testComposeReplyOtherOnly() {
        let d = makeDecision()
        let reply = d.composeReply(optionIds: [], otherText: "Deploy to a preview env")
        XCTAssertTrue(reply.contains("Deploy to a preview env"))
        XCTAssertFalse(reply.contains("I chose:"), "free-text-only takes the prose form")
    }

    func testComposeReplyChoicePlusOther() {
        let d = makeDecision()
        let reply = d.composeReply(optionIds: ["staging"], otherText: "but gate behind a flag")
        XCTAssertTrue(reply.contains("Staging"))
        XCTAssertTrue(reply.contains("but gate behind a flag"))
    }

    // MARK: - Pending → answered settle

    func testPendingThenSettled() {
        var d = makeDecision()
        XCTAssertTrue(d.isPending)
        d.answer = DecisionAnswer(chosenOptionIds: ["prod"], otherText: nil, answeredAt: Date())
        XCTAssertFalse(d.isPending)
        XCTAssertEqual(d.answer?.chosenOptionIds, ["prod"])
    }

    // MARK: - Preserve-answer merge (mirrors the stream re-parse rule)

    func testPreserveAnswerAcrossReparse() {
        // Simulate: a decision is answered, then a re-parse produces a fresh,
        // unanswered copy at the same id. The stream merges the prior answer back.
        var answered = makeDecision()
        answered.answer = DecisionAnswer(chosenOptionIds: ["canary"], otherText: nil, answeredAt: Date())

        var reparsed = makeDecision() // fresh, answer == nil
        let priorAnswers: [String: DecisionAnswer] = [answered.id: answered.answer!]
        if let prior = priorAnswers[reparsed.id] { reparsed.answer = prior }

        XCTAssertFalse(reparsed.isPending, "re-parse must not wipe a chosen answer")
        XCTAssertEqual(reparsed.answer?.chosenOptionIds, ["canary"])
    }
}
