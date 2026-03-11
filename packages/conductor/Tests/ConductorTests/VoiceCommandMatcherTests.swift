// VoiceCommandMatcherTests.swift
// Tests for #voice-command-matcher phrase detection and fuzzy matching.

import XCTest
@testable import Conductor

final class VoiceCommandMatcherTests: XCTestCase {

    private let commands: [String: ConductorAction] = [
        "send it": .send,
        "send": .send,
        "undo": .undo,
        "undo that": .undo,
        "redo": .redo,
    ]

    // MARK: - Exact Match at End

    func testExactMatchAtEnd() {
        let matcher = VoiceCommandMatcher()
        let result = matcher.match(transcription: "fix the login bug and send it", commands: commands)
        XCTAssertEqual(result.action, .send)
        XCTAssertEqual(result.remainingText, "fix the login bug and")
        XCTAssertEqual(result.matchedPhrase, "send it")
    }

    // MARK: - Exact Match at Start

    func testExactMatchAtStart() {
        let matcher = VoiceCommandMatcher()
        let result = matcher.match(transcription: "undo the last change", commands: commands)
        XCTAssertEqual(result.action, .undo)
        XCTAssertEqual(result.remainingText, "the last change")
    }

    // MARK: - No Match

    func testNoMatchReturnsNil() {
        let matcher = VoiceCommandMatcher()
        let result = matcher.match(transcription: "fix the login bug please", commands: commands)
        XCTAssertNil(result.action)
        XCTAssertEqual(result.remainingText, "fix the login bug please")
    }

    // MARK: - Case Insensitive

    func testCaseInsensitive() {
        let matcher = VoiceCommandMatcher()
        let result = matcher.match(transcription: "Fix this and SEND IT", commands: commands)
        XCTAssertEqual(result.action, .send)
    }

    // MARK: - Longer Phrase Preferred

    func testLongerPhrasePreferred() {
        let matcher = VoiceCommandMatcher()
        // "send it" should be preferred over "send" since it's more specific
        let result = matcher.match(transcription: "do it and send it", commands: commands)
        XCTAssertEqual(result.matchedPhrase, "send it")
    }

    // MARK: - Fuzzy Match

    func testFuzzyMatchWithinTolerance() {
        var matcher = VoiceCommandMatcher()
        matcher.fuzzyTolerance = 1
        // "sendd" is 1 edit away from "send"
        let result = matcher.match(transcription: "fix this and sendd", commands: commands)
        XCTAssertEqual(result.action, .send)
    }

    func testFuzzyMatchBeyondToleranceReturnsNil() {
        var matcher = VoiceCommandMatcher()
        matcher.fuzzyTolerance = 1
        // "senzzz" is 3 edits away from "send"
        let result = matcher.match(transcription: "fix this and senzzz", commands: commands)
        XCTAssertNil(result.action)
    }

    // MARK: - Levenshtein Distance

    func testLevenshteinDistanceSameString() {
        XCTAssertEqual(VoiceCommandMatcher.levenshteinDistance("hello", "hello"), 0)
    }

    func testLevenshteinDistanceOneEdit() {
        XCTAssertEqual(VoiceCommandMatcher.levenshteinDistance("send", "sendd"), 1)
    }

    func testLevenshteinDistanceCompletelyDifferent() {
        XCTAssertEqual(VoiceCommandMatcher.levenshteinDistance("abc", "xyz"), 3)
    }
}
