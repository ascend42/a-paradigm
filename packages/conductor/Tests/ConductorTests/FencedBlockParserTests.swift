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

    func testDecisionSymbolGroundingDecodes() {
        // A decision envelope carrying a top-level "symbols" array and per-option
        // "affectedSymbols" — the graph-grounding fields (Phase-2b). Tolerant decode.
        let text = """
        Pick one:
        ```conductor-decision
        {"id":"g","question":"Where?","symbols":["#payment-form","$checkout-flow"],"options":[{"id":"a","label":"A","affectedSymbols":["#payment-form","!payment-method-added"]},{"id":"b","label":"B","affectedSymbols":["$checkout-flow"]}],"multiSelect":false,"allowOther":false}
        ```
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertEqual(r.decisions.count, 1)
        let d = r.decisions.first
        XCTAssertEqual(d?.symbols, ["#payment-form", "$checkout-flow"])
        XCTAssertEqual(d?.options.first(where: { $0.id == "a" })?.affectedSymbols,
                       ["#payment-form", "!payment-method-added"])
        XCTAssertEqual(d?.options.first(where: { $0.id == "b" })?.affectedSymbols,
                       ["$checkout-flow"])
    }

    func testDecisionWithoutSymbolFieldsDefaultsEmpty() {
        // Schema-tolerant: a decision with no symbols/affectedSymbols decodes with [].
        let text = """
        ```conductor-decision
        {"id":"x","question":"Pick","options":[{"id":"a","label":"A"}]}
        ```
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertEqual(r.decisions.first?.symbols, [])
        XCTAssertEqual(r.decisions.first?.options.first?.affectedSymbols, [])
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

    // MARK: - Graph envelope (the real `paradigm graph slice --as-lightbox` shape)

    func testConductorVisualGraphEnvelope() {
        // The authoritative envelope shape Phase-1 `graph slice --as-lightbox` emits.
        let text = """
        ```conductor-visual
        {"id":"graph-atrium-decision-card","kind":"graph","title":"Graph slice: #atrium-decision-card","payload":{"root":"#atrium-decision-card","freshness":{"generatedAt":"2026-06-17T22:18:42.232Z","stale":false},"nodes":[{"id":"#atrium-decision-card","kind":"component","label":"Atrium Decision Card","path":"/abs/.purpose"},{"id":"#agent-decision","kind":"component","label":"Agent Decision","path":"/abs/.purpose"},{"id":"$decision-exchange","kind":"flow","label":"Decision Exchange"},{"id":"^authenticated","kind":"gate","label":"Authenticated"},{"id":"!decision-answered","kind":"signal","label":"Decision Answered"},{"id":"~audit-required","kind":"aspect","label":"Audit Required"}],"edges":[{"source":"#atrium-decision-card","target":"#agent-decision","kind":"uses"},{"source":"#atrium-decision-card","target":"$decision-exchange","kind":"in-flow"},{"source":"#atrium-decision-card","target":"^authenticated","kind":"gated-by"},{"source":"#atrium-decision-card","target":"!decision-answered","kind":"used-by"}],"truncated":false}}
        ```
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertEqual(r.visuals.count, 1)
        let v = r.visuals.first
        XCTAssertEqual(v?.kind, .graph)
        XCTAssertEqual(v?.id, "graph-atrium-decision-card")
        XCTAssertEqual(v?.title, "Graph slice: #atrium-decision-card")

        let g = v?.graph
        XCTAssertNotNil(g)
        XCTAssertEqual(g?.root, "#atrium-decision-card")
        XCTAssertEqual(g?.nodes.count, 6)
        XCTAssertEqual(g?.edges.count, 4)
        XCTAssertEqual(g?.truncated, false)
        XCTAssertEqual(g?.generatedAt, "2026-06-17T22:18:42.232Z")
        XCTAssertEqual(g?.stale, false)

        // Node kinds decode from the explicit `kind` string.
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "$decision-exchange" })?.kind, .flow)
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "^authenticated" })?.kind, .gate)
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "!decision-answered" })?.kind, .signal)
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "~audit-required" })?.kind, .aspect)
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "#agent-decision" })?.kind, .component)
        // Path retained when present.
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "#agent-decision" })?.path, "/abs/.purpose")

        // Edge kinds decode (hyphenated forms tolerated).
        XCTAssertEqual(g?.edges.first(where: { $0.target == "$decision-exchange" })?.kind, .inFlow)
        XCTAssertEqual(g?.edges.first(where: { $0.target == "^authenticated" })?.kind, .gatedBy)
        XCTAssertEqual(g?.edges.first(where: { $0.target == "!decision-answered" })?.kind, .usedBy)

        XCTAssertTrue(v?.isRenderable == true)
        // Block stripped from residual.
        XCTAssertFalse(r.residualText.contains("conductor-visual"))
    }

    func testGraphKindFallsBackToIdPrefixWhenKindMissing() {
        // No explicit node.kind → decode from the symbol-id prefix.
        let text = """
        ```conductor-visual
        {"id":"g","kind":"graph","payload":{"root":"#root","nodes":[{"id":"#root","label":"R"},{"id":"$f"},{"id":"^g"},{"id":"!s"},{"id":"~a"},{"id":"$$nested"}]}}
        ```
        """
        let r = FencedBlockParser.parse(text)
        let g = r.visuals.first?.graph
        XCTAssertNotNil(g)
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "#root" })?.kind, .component)
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "$f" })?.kind, .flow)
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "^g" })?.kind, .gate)
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "!s" })?.kind, .signal)
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "~a" })?.kind, .aspect)
        // `$$` double-prefix still resolves to flow.
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "$$nested" })?.kind, .flow)
        // label falls back to id when absent.
        XCTAssertEqual(g?.nodes.first(where: { $0.id == "$f" })?.label, "$f")
    }

    func testGraphWithNoNodesIsDropped() {
        // Mirror the .flow guard: empty nodes → no visual.
        let text = """
        ```conductor-visual
        {"id":"g","kind":"graph","payload":{"root":"#x","nodes":[],"edges":[]}}
        ```
        After.
        """
        let r = FencedBlockParser.parse(text)
        XCTAssertTrue(r.visuals.isEmpty, "empty nodes → dropped, no crash")
        XCTAssertTrue(r.residualText.contains("After."))
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
