// EnrichedPayloadTests.swift
// Tests for #conductor-models EnrichedPayload context assembly.

import XCTest
@testable import Conductor

final class EnrichedPayloadTests: XCTestCase {

    func testRawTextOnlyNoEnrichment() {
        let payload = EnrichedPayload(text: "fix the login bug")
        XCTAssertFalse(payload.isEnriched)
        XCTAssertEqual(payload.assembledText(), "fix the login bug")
    }

    func testWithParadigmStatus() {
        var payload = EnrichedPayload(text: "add auth")
        payload.paradigmStatus = "Project: myapp, 12 symbols"
        XCTAssertTrue(payload.isEnriched)

        let assembled = payload.assembledText()
        XCTAssertTrue(assembled.hasPrefix("add auth"))
        XCTAssertTrue(assembled.contains("<!-- Paradigm Context -->"))
        XCTAssertTrue(assembled.contains("Project: myapp, 12 symbols"))
    }

    func testWithGitDiffSummary() {
        var payload = EnrichedPayload(text: "review changes")
        payload.gitDiffSummary = "3 files changed, +42 -7"
        XCTAssertTrue(payload.isEnriched)

        let assembled = payload.assembledText()
        XCTAssertTrue(assembled.contains("Recent changes: 3 files changed, +42 -7"))
    }

    func testWithRelevantSymbols() {
        var payload = EnrichedPayload(text: "check auth")
        payload.relevantSymbols = ["#login-handler", "^authenticated"]
        XCTAssertTrue(payload.isEnriched)

        let assembled = payload.assembledText()
        XCTAssertTrue(assembled.contains("Relevant symbols: #login-handler, ^authenticated"))
    }

    func testWithAllSections() {
        var payload = EnrichedPayload(text: "deploy")
        payload.paradigmStatus = "status info"
        payload.relevantSymbols = ["#deploy"]
        payload.gitDiffSummary = "1 file changed"
        payload.historyContext = "recent history"
        XCTAssertTrue(payload.isEnriched)

        let assembled = payload.assembledText()
        XCTAssertTrue(assembled.hasPrefix("deploy"))
        XCTAssertTrue(assembled.contains("status info"))
        XCTAssertTrue(assembled.contains("#deploy"))
        XCTAssertTrue(assembled.contains("1 file changed"))
    }

    func testEmptyRawTextWithEnrichment() {
        var payload = EnrichedPayload(text: "")
        payload.paradigmStatus = "some status"
        XCTAssertTrue(payload.isEnriched)

        let assembled = payload.assembledText()
        XCTAssertTrue(assembled.contains("some status"))
    }
}
