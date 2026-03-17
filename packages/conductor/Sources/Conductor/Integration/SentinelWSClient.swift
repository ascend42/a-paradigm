// SentinelWSClient.swift — #sentinel-ws-client
// WebSocket client for real-time Sentinel events.

import Foundation

/// Connects to the Sentinel WebSocket server for real-time event monitoring.
@MainActor
final class SentinelWSClient: ObservableObject {
    @Published private(set) var isConnected: Bool = false
    @Published private(set) var lastEvent: SentinelEvent?
    @Published private(set) var recentEvents: [SentinelEvent] = []
    @Published private(set) var activeSymbols: [String] = []

    /// Maximum number of events to buffer.
    private let maxBufferSize = 200

    /// Symbol frequency tracking for active symbols.
    private var symbolCounts: [String: Int] = [:]

    private var webSocketTask: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)

    /// Default Sentinel WebSocket URL.
    var serverURL: URL = URL(string: "ws://localhost:3838/ws")!

    // MARK: - Connection

    func connect() {
        disconnect()

        let task = session.webSocketTask(with: serverURL)
        task.resume()
        self.webSocketTask = task
        isConnected = true

        ConductorLog.component("sentinel-ws-client").info("Connected to Sentinel WS")
        receiveLoop()
    }

    func disconnect() {
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        isConnected = false
    }

    // MARK: - Receiving

    private func receiveLoop() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    Task { @MainActor in
                        self?.handleMessage(text)
                    }
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        Task { @MainActor in
                            self?.handleMessage(text)
                        }
                    }
                @unknown default:
                    break
                }
                // Continue receiving
                self?.receiveLoop()

            case .failure(let error):
                Task { @MainActor in
                    self?.isConnected = false
                    ConductorLog.component("sentinel-ws-client")
                        .info("WS disconnected: \(error.localizedDescription)")
                }
            }
        }
    }

    /// Parse and buffer a raw JSON message from Sentinel. Internal for testability.
    func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        // Extract metadata: all keys except the known ones
        let knownKeys: Set<String> = ["type", "level", "symbol", "message"]
        var metadata: [String: String] = [:]
        for (key, value) in json where !knownKeys.contains(key) {
            metadata[key] = "\(value)"
        }

        let event = SentinelEvent(
            id: UUID().uuidString,
            type: json["type"] as? String ?? "unknown",
            level: json["level"] as? String ?? "info",
            symbol: json["symbol"] as? String,
            message: json["message"] as? String,
            timestamp: Date(),
            metadata: metadata.isEmpty ? nil : metadata
        )

        lastEvent = event
        recentEvents.append(event)
        if recentEvents.count > maxBufferSize {
            recentEvents.removeFirst(recentEvents.count - maxBufferSize)
        }

        // Track symbol frequency
        if let symbol = event.symbol {
            symbolCounts[symbol, default: 0] += 1
            activeSymbols = symbolCounts.sorted { $0.value > $1.value }.map(\.key)
        }
    }

    // MARK: - Filtering

    /// Filter events by symbol.
    func events(forSymbol symbol: String) -> [SentinelEvent] {
        recentEvents.filter { $0.symbol == symbol }
    }

    /// Clear the event buffer and symbol tracking.
    func clearBuffer() {
        recentEvents.removeAll()
        symbolCounts.removeAll()
        activeSymbols.removeAll()
        lastEvent = nil
    }
}

/// A real-time event from Sentinel.
struct SentinelEvent: Identifiable, Hashable {
    let id: String
    let type: String
    let level: String
    let symbol: String?
    let message: String?
    let timestamp: Date
    var metadata: [String: String]?

    static func == (lhs: SentinelEvent, rhs: SentinelEvent) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}
