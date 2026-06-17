// FencedBlockParserTests.swift
// Tests for #fenced-block-parser — streaming/partial fence tolerance, malformed
// JSON degradation, multi-block, residual stripping, stable identity, answer preserve.

import XCTest
@testable import Conductor

final class FencedBlockParserTests: XCTestCase {

    // MARK: - Streaming / partial fence

    func testOpenFenceStillStreamingEmitsNothing() {
        // A conductor-decision fence whose closing ``` hasn't arrived yet.
        let text = """
        Here are your options:
        ```conductor-decision
        {"id":"x","question":"Pick","options":[{"id":"a","label":"A"}]
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertTrue(r.decisions.isEmpty, "no closing fence → no emit")
        XCTAssertTrue(r.visuals.isEmpty)
        // The partial fence stays as raw residual text (renders as plain text).
        XCTAssertTrue(r.residualText.contains("```conductor-decision"))
    }

    func testClosedFenceEmits() {
        let text = """
        Pick one:
        ```conductor-decision
        {"id":"x","question":"Pick","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"multiSelect":false,"allowOther":true}
        ```
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertEqual(r.decisions.count, 1)
        XCTAssertEqual(r.decisions.first?.id, "x")
        XCTAssertEqual(r.decisions.first?.options.count, 2)
        XCTAssertEqual(r.decisions.first?.allowOther, true)
        // Block stripped from residual; prose preserved.
        XCTAssertEqual(r.residualText, "Pick one:")
        XCTAssertFalse(r.residualText.contains("conductor-decision"))
    }

    // MARK: - Malformed JSON tolerance

    func testMalformedDecisionJSONDoesNotThrowAndDropsBlock() {
        let text = """
        ```conductor-decision
        {this is not json at all}
        ```
        After.
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertTrue(r.decisions.isEmpty, "malformed JSON → dropped, no crash")
        XCTAssertTrue(r.residualText.contains("After."))
    }

    func testDecisionMissingQuestionIsDropped() {
        let text = """
        ```conductor-decision
        {"id":"x","options":[{"id":"a","label":"A"}]}
        ```
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertTrue(r.decisions.isEmpty)
    }

    // MARK: - Multi-block

    func testMultipleBlocksMixedKinds() {
        let text = """
        Intro.
        ```conductor-decision
        {"id":"d1","question":"Q1","options":[{"id":"a","label":"A"}]}
        ```
        Middle.
        ```mermaid
        flowchart TD
          A --> B
        ```
        End.
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertEqual(r.decisions.count, 1)
        XCTAssertEqual(r.visuals.count, 1)
        XCTAssertEqual(r.visuals.first?.kind, .flow)
        XCTAssertTrue(r.visuals.first?.mermaid?.contains("flowchart TD") == true)
        XCTAssertTrue(r.residualText.contains("Intro."))
        XCTAssertTrue(r.residualText.contains("Middle."))
        XCTAssertTrue(r.residualText.contains("End."))
    }

    func testConductorVisualFlowEnvelope() {
        let text = """
        ```conductor-visual
        {"id":"v1","kind":"flow","title":"T","payload":{"mermaid":"flowchart LR\\n A-->B"}}
        ```
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertEqual(r.visuals.count, 1)
        XCTAssertEqual(r.visuals.first?.kind, .flow)
        XCTAssertEqual(r.visuals.first?.title, "T")
        XCTAssertTrue(r.visuals.first?.mermaid?.contains("A-->B") == true)
    }

    func testConductorVisualComparisonEnvelope() {
        let text = """
        ```conductor-visual
        {"id":"c1","kind":"comparison","payload":{"columns":["X","Y"],"rows":[{"label":"r","cells":["1","2"]}]}}
        ```
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertEqual(r.visuals.count, 1)
        XCTAssertEqual(r.visuals.first?.kind, .comparison)
        XCTAssertEqual(r.visuals.first?.comparison?.columns, ["X", "Y"])
        XCTAssertEqual(r.visuals.first?.comparison?.rows.first?.cells, ["1", "2"])
    }

    // MARK: - Non-host code blocks left untouched

    func testNonHostCodeBlockPreservedInResidual() {
        let text = """
        Look:
        ```swift
        let x = 1
        ```
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertTrue(r.decisions.isEmpty)
        XCTAssertTrue(r.visuals.isEmpty)
        XCTAssertTrue(r.residualText.contains("```swift"))
        XCTAssertTrue(r.residualText.contains("let x = 1"))
    }

    // MARK: - Stable identity across re-parse

    func testStableIdentityAcrossReparse() {
        let partial = """
        ```conductor-decision
        {"id":"keep","question":"Q","options":[{"id":"a","label":"A"}]}
        ```
        """
        let more = partial + "\n\nFollow-up prose continues streaming."
        let r1 = FencedBlockParser.parse(partial)
        let r2 = FencedBlockParser.parse(more)
        XCTAssertEqual(r1.decisions.first?.id, "keep")
        XCTAssertEqual(r2.decisions.first?.id, "keep", "explicit id stays stable across re-parse")
    }

    func testSyntheticIdentityByOrdinal() {
        let text = """
        ```conductor-decision
        {"question":"Q","options":[{"id":"a","label":"A"}]}
        ```
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertEqual(r.decisions.first?.id, "decision-0", "no explicit id → (lang,ordinal) synthetic")
    }
}
