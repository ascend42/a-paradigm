// ContextEnricher.swift — #context-enricher
// Assembles Paradigm + git context for dispatch enrichment.
// Implementation of ContextEnricherProtocol.

import Foundation

/// Enriches dispatch text with Paradigm project context and git diff summaries.
@MainActor
final class ParadigmContextEnricher: ObservableObject {
    /// MCP clients keyed by project directory.
    private var mcpClients: [String: ParadigmMCPClient] = [:]

    /// Git monitors keyed by project directory.
    private var gitMonitors: [String: GitMonitor] = [:]

    @Published var isEnabled: Bool = true

    /// Cache TTL matching MCP tool cache (30s).
    private let cacheTTL: TimeInterval = 30.0
    private var cache: [String: (payload: EnrichedPayload, timestamp: Date)] = [:]

    var isAvailable: Bool {
        // Available if at least one MCP client is connected
        mcpClients.values.contains { $0.isConnected }
    }

    // MARK: - ContextEnricherProtocol

    func enrich(_ text: String, for projectDir: String) async -> EnrichedPayload {
        guard isEnabled else {
            return EnrichedPayload(text: text)
        }

        // Check cache
        if let cached = cache[projectDir],
           Date().timeIntervalSince(cached.timestamp) < cacheTTL {
            var payload = cached.payload
            payload = EnrichedPayload(
                text: text,
                paradigmStatus: payload.paradigmStatus,
                relevantSymbols: payload.relevantSymbols,
                gitDiffSummary: payload.gitDiffSummary,
                historyContext: payload.historyContext
            )
            return payload
        }

        var payload = EnrichedPayload(text: text)

        // Get or create MCP client for this project
        let mcpClient = getOrCreateMCPClient(for: projectDir)

        // Get or create git monitor
        let gitMonitor = getOrCreateGitMonitor(for: projectDir)

        // Gather context in parallel
        async let statusResult = fetchStatus(from: mcpClient)
        async let symbolsResult = fetchSymbols(from: mcpClient, query: text)
        async let historyResult = fetchHistory(from: mcpClient)

        payload.paradigmStatus = await statusResult
        payload.relevantSymbols = await symbolsResult
        payload.historyContext = await historyResult
        payload.gitDiffSummary = gitMonitor.lastDiffSummary

        // Cache the context (not the text)
        cache[projectDir] = (payload: payload, timestamp: Date())

        if payload.isEnriched {
            ConductorLog.signal("context-enriched")
                .info("Context enriched for \(projectDir)")
        }

        return payload
    }

    // MARK: - Setup

    func setupForProject(_ projectDir: String) async {
        let client = getOrCreateMCPClient(for: projectDir)
        if !client.isConnected {
            try? await client.connect()
        }

        let monitor = getOrCreateGitMonitor(for: projectDir)
        monitor.startPolling()
    }

    func teardownForProject(_ projectDir: String) {
        mcpClients[projectDir]?.disconnect()
        mcpClients.removeValue(forKey: projectDir)
        gitMonitors[projectDir]?.stopPolling()
        gitMonitors.removeValue(forKey: projectDir)
        cache.removeValue(forKey: projectDir)
    }

    // MARK: - Private

    private func getOrCreateMCPClient(for projectDir: String) -> ParadigmMCPClient {
        if let existing = mcpClients[projectDir] {
            return existing
        }
        let client = ParadigmMCPClient(projectDirectory: projectDir)
        mcpClients[projectDir] = client
        return client
    }

    private func getOrCreateGitMonitor(for projectDir: String) -> GitMonitor {
        if let existing = gitMonitors[projectDir] {
            return existing
        }
        let monitor = GitMonitor(projectDirectory: projectDir)
        gitMonitors[projectDir] = monitor
        return monitor
    }

    private func fetchStatus(from client: ParadigmMCPClient) async -> String? {
        guard client.isConnected else { return nil }
        return try? await client.getStatus()
    }

    private func fetchSymbols(from client: ParadigmMCPClient, query: String) async -> [String]? {
        guard client.isConnected, !query.isEmpty else { return nil }
        return try? await client.search(query: query)
    }

    private func fetchHistory(from client: ParadigmMCPClient) async -> String? {
        guard client.isConnected else { return nil }
        return try? await client.getHistoryContext()
    }
}
