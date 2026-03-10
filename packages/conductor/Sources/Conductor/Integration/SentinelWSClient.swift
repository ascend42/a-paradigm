// SentinelWSClient.swift — #sentinel-ws-client
// WebSocket client for real-time Sentinel events.

import Foundation

/// Connects to the Sentinel WebSocket server for real-time event monitoring.
@MainActor
final class SentinelWSClient: ObservableObject {
    @Published private(set) var isConnected: Bool = false
    @Published private(set) var lastEvent: SentinelEvent?

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

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        let event = SentinelEvent(
            type: json["type"] as? String ?? "unknown",
            symbol: json["symbol"] as? String,
            message: json["message"] as? String,
            timestamp: Date()
        )

        lastEvent = event
    }
}

/// A real-time event from Sentinel.
struct SentinelEvent {
    let type: String
    let symbol: String?
    let message: String?
    let timestamp: Date
}
