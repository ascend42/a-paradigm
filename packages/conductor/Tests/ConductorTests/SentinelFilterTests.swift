// SentinelFilterTests.swift
// Tests for #sentinel-symbol-filter — symbol filtering, event querying, buffer clear.

import XCTest
@testable import Conductor

@MainActor
final class SentinelFilterTests: XCTestCase {

    private func feedEvent(_ client: SentinelWSClient, symbol: String?, level: String = "info", message: String = "test") {
        var json: [String: Any] = ["type": "log", "level": level, "message": message]
        if let symbol { json["symbol"] = symbol }
        if let data = try? JSONSerialization.data(withJSONObject: json),
           let text = String(data: data, encoding: .utf8) {
            client.handleMessage(text)
        }
    }

    func testSymbolFilterReturnsMatching() {
        let client = SentinelWSClient()
        feedEvent(client, symbol: "#auth")
        feedEvent(client, symbol: "#db")
        feedEvent(client, symbol: "#auth")

        let authEvents = client.events(forSymbol: "#auth")
        XCTAssertEqual(authEvents.count, 2)
        XCTAssertTrue(authEvents.allSatisfy { $0.symbol == "#auth" })
    }

    func testSymbolFilterEmptyForUnknown() {
        let client = SentinelWSClient()
        feedEvent(client, symbol: "#auth")
        feedEvent(client, symbol: "#db")

        let result = client.events(forSymbol: "#nonexistent")
        XCTAssertTrue(result.isEmpty)
    }

    func testClearResetsEverything() {
        let client = SentinelWSClient()
        feedEvent(client, symbol: "#auth")
        feedEvent(client, symbol: "#db")

        XCTAssertFalse(client.recentEvents.isEmpty)
        XCTAssertFalse(client.activeSymbols.isEmpty)

        client.clearBuffer()

        XCTAssertTrue(client.recentEvents.isEmpty)
        XCTAssertTrue(client.activeSymbols.isEmpty)
        XCTAssertNil(client.lastEvent)
    }
}
