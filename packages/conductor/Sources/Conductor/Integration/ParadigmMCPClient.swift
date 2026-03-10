// ParadigmMCPClient.swift — #paradigm-mcp-client
// Spawns paradigm-mcp as a subprocess and calls tools via stdio JSON-RPC.

import Foundation

/// Client for communicating with paradigm-mcp via stdio JSON-RPC.
/// One instance per project directory.
@MainActor
final class ParadigmMCPClient: ObservableObject {
    let projectDirectory: String

    @Published private(set) var isConnected: Bool = false

    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutPipe: Pipe?
    private var requestID: Int = 0
    private var pendingResponses: [Int: CheckedContinuation<MCPResponse, Error>] = [:]

    init(projectDirectory: String) {
        self.projectDirectory = projectDirectory
    }

    // MARK: - Lifecycle

    func connect() async throws {
        let proc = Process()

        // Find paradigm-mcp binary
        if let path = findParadigmMCP() {
            proc.executableURL = URL(fileURLWithPath: path)
        } else {
            throw MCPClientError.binaryNotFound
        }

        proc.currentDirectoryURL = URL(fileURLWithPath: projectDirectory)

        let stdin = Pipe()
        let stdout = Pipe()
        proc.standardInput = stdin
        proc.standardOutput = stdout
        proc.standardError = FileHandle.nullDevice

        // Read responses from stdout
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            Task { @MainActor in
                self?.handleOutput(data)
            }
        }

        try proc.run()
        self.process = proc
        self.stdinPipe = stdin
        self.stdoutPipe = stdout
        self.isConnected = true

        let dir = projectDirectory
        ConductorLog.component("paradigm-mcp-client")
            .info("Connected to paradigm-mcp for \(dir)")
    }

    func disconnect() {
        process?.terminate()
        process = nil
        stdinPipe = nil
        stdoutPipe = nil
        isConnected = false
    }

    // MARK: - Tool Calls

    /// Call paradigm_status to get project overview.
    func getStatus() async throws -> String {
        let response = try await callTool("paradigm_status", params: [:])
        return response.resultText
    }

    /// Call paradigm_search to find relevant symbols.
    func search(query: String) async throws -> [String] {
        let response = try await callTool("paradigm_search", params: ["query": query])
        // Parse symbol names from response
        return response.resultText
            .components(separatedBy: .newlines)
            .filter { !$0.isEmpty }
    }

    /// Call paradigm_history_context for recent history.
    func getHistoryContext() async throws -> String {
        let response = try await callTool("paradigm_history_context", params: [:])
        return response.resultText
    }

    // MARK: - JSON-RPC

    private func callTool(_ name: String, params: [String: Any]) async throws -> MCPResponse {
        guard isConnected else { throw MCPClientError.notConnected }

        requestID += 1
        let id = requestID

        let request: [String: Any] = [
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": [
                "name": name,
                "arguments": params
            ]
        ]

        let data = try JSONSerialization.data(withJSONObject: request)
        var message = data
        message.append(contentsOf: "\n".utf8)

        return try await withCheckedThrowingContinuation { continuation in
            pendingResponses[id] = continuation
            stdinPipe?.fileHandleForWriting.write(message)
        }
    }

    private func handleOutput(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }

        for line in text.components(separatedBy: .newlines) where !line.isEmpty {
            guard let lineData = line.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                  let id = json["id"] as? Int else {
                continue
            }

            let resultText: String
            if let result = json["result"] as? [String: Any],
               let content = result["content"] as? [[String: Any]],
               let first = content.first,
               let text = first["text"] as? String {
                resultText = text
            } else if let error = json["error"] as? [String: Any] {
                let continuation = pendingResponses.removeValue(forKey: id)
                continuation?.resume(throwing: MCPClientError.toolError(
                    error["message"] as? String ?? "Unknown error"
                ))
                return
            } else {
                resultText = ""
            }

            let continuation = pendingResponses.removeValue(forKey: id)
            continuation?.resume(returning: MCPResponse(resultText: resultText))
        }
    }

    // MARK: - Binary Discovery

    private nonisolated func findParadigmMCP() -> String? {
        // Check common locations
        let candidates = [
            "/usr/local/bin/paradigm-mcp",
            "/opt/homebrew/bin/paradigm-mcp",
            "\(NSHomeDirectory())/.npm-global/bin/paradigm-mcp",
        ]

        for path in candidates {
            if FileManager.default.isExecutableFile(atPath: path) {
                return path
            }
        }

        // Try `which`
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        proc.arguments = ["paradigm-mcp"]
        let pipe = Pipe()
        proc.standardOutput = pipe
        try? proc.run()
        proc.waitUntilExit()

        if let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !output.isEmpty {
            return output
        }

        return nil
    }
}

// MARK: - Types

struct MCPResponse {
    let resultText: String
}

enum MCPClientError: Error, LocalizedError {
    case binaryNotFound
    case notConnected
    case toolError(String)

    var errorDescription: String? {
        switch self {
        case .binaryNotFound:
            return "paradigm-mcp binary not found. Install with: npm install -g @a-company/paradigm"
        case .notConnected:
            return "Not connected to paradigm-mcp"
        case .toolError(let message):
            return "MCP tool error: \(message)"
        }
    }
}
