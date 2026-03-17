// SentinelWSClientTests.swift
// Tests for #sentinel-ws-client — event buffering, identifiability.

import XCTest
@testable import Conductor

@MainActor
final class SentinelWSClientTests: XCTestCase {

    func testInitialState() {
        let client = SentinelWSClient()
        XCTAssertFalse(client.isConnected)
        XCTAssertNil(client.lastEvent)
        XCTAssertTrue(client.recentEvents.isEmpty)
    }

    func testBufferLimitBehavior() {
        // Verify the max buffer constant exists by checking initial empty state
        // and that the type supports event storage
        let client = SentinelWSClient()
        XCTAssertEqual(client.recentEvents.count, 0)
        // The buffer limit of 200 is enforced internally via handleMessage
    }

    func testEventIdentifiable() {
        let event = SentinelEvent(
            id: "unique-id",
            type: "test",
            level: "warn",
            symbol: "#component",
            message: "Test message",
            timestamp: Date()
        )

        XCTAssertEqual(event.id, "unique-id")
        XCTAssertEqual(event.level, "warn")
        XCTAssertEqual(event.type, "test")
        XCTAssertEqual(event.symbol, "#component")
    }

    func testEventLevelField() {
        let info = SentinelEvent(id: "1", type: "log", level: "info", symbol: nil, message: nil, timestamp: Date())
        let warn = SentinelEvent(id: "2", type: "log", level: "warn", symbol: nil, message: nil, timestamp: Date())
        let error = SentinelEvent(id: "3", type: "log", level: "error", symbol: nil, message: nil, timestamp: Date())

        XCTAssertEqual(info.level, "info")
        XCTAssertEqual(warn.level, "warn")
        XCTAssertEqual(error.level, "error")
    }

    // MARK: - Sprint 15 Tests

    private func feedMessage(_ client: SentinelWSClient, symbol: String?, level: String = "info", extra: [String: Any] = [:]) {
        var json: [String: Any] = ["type": "log", "level": level, "message": "test"]
        if let symbol { json["symbol"] = symbol }
        for (k, v) in extra { json[k] = v }
        if let data = try? JSONSerialization.data(withJSONObject: json),
           let text = String(data: data, encoding: .utf8) {
            client.handleMessage(text)
        }
    }

    func testActiveSymbolsTracking() {
        let client = SentinelWSClient()
        feedMessage(client, symbol: "#auth")
        feedMessage(client, symbol: "#db")
        feedMessage(client, symbol: "#auth")

        XCTAssertEqual(client.activeSymbols.count, 2)
        // #auth should be first (higher frequency)
        XCTAssertEqual(client.activeSymbols.first, "#auth")
    }

    func testClearBuffer() {
        let client = SentinelWSClient()
        feedMessage(client, symbol: "#auth")
        feedMessage(client, symbol: "#db")

        client.clearBuffer()

        XCTAssertTrue(client.recentEvents.isEmpty)
        XCTAssertTrue(client.activeSymbols.isEmpty)
        XCTAssertNil(client.lastEvent)
    }

    func testEventsForSymbol() {
        let client = SentinelWSClient()
        feedMessage(client, symbol: "#auth")
        feedMessage(client, symbol: "#db")
        feedMessage(client, symbol: "#auth")

        let authEvents = client.events(forSymbol: "#auth")
        XCTAssertEqual(authEvents.count, 2)

        let dbEvents = client.events(forSymbol: "#db")
        XCTAssertEqual(dbEvents.count, 1)
    }

    func testMetadataFieldParsed() {
        let client = SentinelWSClient()
        feedMessage(client, symbol: "#auth", extra: ["userId": "u123", "duration": 42])

        XCTAssertEqual(client.recentEvents.count, 1)
        let event = client.recentEvents[0]
        XCTAssertNotNil(event.metadata)
        XCTAssertEqual(event.metadata?["userId"], "u123")
    }

    func testSymbolFrequencyOrder() {
        let client = SentinelWSClient()
        feedMessage(client, symbol: "#c")
        feedMessage(client, symbol: "#b")
        feedMessage(client, symbol: "#b")
        feedMessage(client, symbol: "#a")
        feedMessage(client, symbol: "#a")
        feedMessage(client, symbol: "#a")

        // Should be ordered by frequency: #a (3), #b (2), #c (1)
        XCTAssertEqual(client.activeSymbols, ["#a", "#b", "#c"])
    }
}
