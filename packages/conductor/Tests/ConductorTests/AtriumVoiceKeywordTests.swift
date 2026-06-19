// AtriumVoiceKeywordTests.swift
// Tests for #atrium-voice keyword grammar: wake / send / cancel detection with
// word-boundary anchoring (the "responsible" negative case is the headline).

import XCTest
@testable import Conductor

@MainActor
final class AtriumVoiceKeywordTests: XCTestCase {

    // MARK: - Wake keyword ("respond")

    func testWakeKeywordDetected() {
        let after = AtriumVoiceController.textAfterKeyword(
            "respond hello there team", keyword: "respond"
        )
        XCTAssertEqual(after, "hello there team")
    }

    func testWakeKeywordWithNoTrailingTextReturnsEmpty() {
        let after = AtriumVoiceController.textAfterKeyword("respond", keyword: "respond")
        XCTAssertEqual(after, "")
    }

    func testWakeKeywordCaseAndPunctuationInsensitive() {
        let after = AtriumVoiceController.textAfterKeyword(
            "Respond, please write this down.", keyword: "respond"
        )
        XCTAssertEqual(after, "please write this down")
    }

    func testWakeKeywordUsesLastOccurrence() {
        let after = AtriumVoiceController.textAfterKeyword(
            "respond first respond second", keyword: "respond"
        )
        XCTAssertEqual(after, "second")
    }

    // MARK: - Negative: word-boundary ("responsible" must NOT match "respond")

    func testRespondDoesNotMatchInsideResponsible() {
        XCTAssertNil(
            AtriumVoiceController.textAfterKeyword(
                "i am responsible for this", keyword: "respond"
            ),
            "'respond' must not fire inside 'responsible'"
        )
    }

    func testRespondDoesNotMatchResponded() {
        XCTAssertNil(
            AtriumVoiceController.textAfterKeyword(
                "he responded quickly", keyword: "respond"
            ),
            "'respond' must not fire inside 'responded'"
        )
    }

    // MARK: - Send phrase ("send it")

    func testSendPhraseSplitsBeforeText() {
        let before = AtriumVoiceController.textBeforeKeyword(
            "this is my message send it", keyword: "send it"
        )
        XCTAssertEqual(before, "this is my message")
    }

    func testSendPhraseMultiWordBoundary() {
        // "send" alone should not trigger the two-word "send it" phrase.
        XCTAssertNil(
            AtriumVoiceController.textBeforeKeyword(
                "please send the file", keyword: "send it"
            )
        )
    }

    func testSendPhraseEmptyBefore() {
        let before = AtriumVoiceController.textBeforeKeyword("send it", keyword: "send it")
        XCTAssertEqual(before, "")
    }

    // MARK: - Cancel phrases

    func testCancelScratchThatDetected() {
        XCTAssertTrue(
            AtriumVoiceController.containsKeyword(
                "no scratch that", anyOf: AtriumVoiceController.cancelKeywords
            )
        )
    }

    func testCancelNeverMindDetected() {
        XCTAssertTrue(
            AtriumVoiceController.containsKeyword(
                "actually never mind", anyOf: AtriumVoiceController.cancelKeywords
            )
        )
    }

    func testCancelNotPresentInPlainText() {
        XCTAssertFalse(
            AtriumVoiceController.containsKeyword(
                "keep this draft please", anyOf: AtriumVoiceController.cancelKeywords
            )
        )
    }

    // MARK: - stripLeadingKeyword

    func testStripsLeadingWakeKeyword() {
        let cleaned = AtriumVoiceController.stripLeadingKeyword(
            "respond write a note", keyword: "respond"
        )
        XCTAssertEqual(cleaned, "write a note")
    }

    func testDoesNotStripWhenNotLeading() {
        let cleaned = AtriumVoiceController.stripLeadingKeyword(
            "please respond now", keyword: "respond"
        )
        XCTAssertEqual(cleaned, "please respond now")
    }
}
