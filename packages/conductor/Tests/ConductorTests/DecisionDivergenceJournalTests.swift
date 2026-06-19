// DecisionDivergenceJournalTests.swift
// Tests for #decision-divergence-journal — the pure divergence GATE (Loid's rule).
// diverged = the human used Other/free-text, OR (a recommendation exists AND the
// chosen set != the single recommended id). No recommendation → false unless Other.

import XCTest
@testable import Conductor

final class DecisionDivergenceJournalTests: XCTestCase {

    private typealias J = DecisionDivergenceJournal

    func testRecommendedChosenIsAgreement() {
        // Grounded, recommended option chosen → NOT diverged (the denominator).
        XCTAssertFalse(J.decisionDiverged(recommendedId: "a", chosenIds: ["a"], usedOther: false))
    }

    func testOtherOptionChosenDiverges() {
        // A recommendation exists but the human picked a different option → diverged.
        XCTAssertTrue(J.decisionDiverged(recommendedId: "a", chosenIds: ["b"], usedOther: false))
    }

    func testUsedOtherAlwaysDiverges() {
        // Free-text "Other" is a divergence regardless of recommendation / chosen.
        XCTAssertTrue(J.decisionDiverged(recommendedId: "a", chosenIds: [], usedOther: true))
        XCTAssertTrue(J.decisionDiverged(recommendedId: "a", chosenIds: ["a"], usedOther: true))
        XCTAssertTrue(J.decisionDiverged(recommendedId: nil, chosenIds: ["a"], usedOther: true))
    }

    func testNoRecommendationIsNotDivergence() {
        // No recommended lean → there is nothing to diverge FROM (unless Other).
        XCTAssertFalse(J.decisionDiverged(recommendedId: nil, chosenIds: ["a"], usedOther: false))
        XCTAssertFalse(J.decisionDiverged(recommendedId: nil, chosenIds: [], usedOther: false))
    }

    func testMultiSelectSupersetOfRecommendationDiverges() {
        // For multiSelect: divergence iff the chosen SET != the single recommended id.
        // Picking the recommended PLUS another is a divergence.
        XCTAssertTrue(J.decisionDiverged(recommendedId: "a", chosenIds: ["a", "b"], usedOther: false))
        // Exactly the recommended id (even as a single-element set) agrees.
        XCTAssertFalse(J.decisionDiverged(recommendedId: "a", chosenIds: ["a"], usedOther: false))
    }

    func testSessionIdSanitizeProducesSafeFilename() {
        XCTAssertEqual(J.sanitize("abc-123_DEF"), "abc-123_DEF")
        XCTAssertEqual(J.sanitize("a/b c"), "a-b-c")
        XCTAssertEqual(J.sanitize(""), "unknown-session")
        XCTAssertEqual(J.sanitize("..."), "unknown-session")
    }
}
