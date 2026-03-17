// SentinelLiveView.swift — #sentinel-live-view
// Real-time Sentinel event viewer with symbol filtering, event detail, and auto-scroll.

import SwiftUI

struct SentinelLiveView: View {
    @ObservedObject var sentinelClient: SentinelWSClient
    var taskStore: TaskStore?

    @State private var searchText = ""
    @State private var levelFilter: String = "All"
    @State private var autoScroll = true
    @State private var selectedSymbol: String?
    @State private var selectedEvent: SentinelEvent?

    private let levels = ["All", "info", "warn", "error"]

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 6) {
                // Connection + filter bar
                HStack(spacing: 8) {
                    // Connection indicator
                    HStack(spacing: 4) {
                        Circle()
                            .fill(sentinelClient.isConnected ? .green : .red)
                            .frame(width: 6, height: 6)
                        Text(sentinelClient.isConnected ? "Connected" : "Disconnected")
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                    }

                    Button(sentinelClient.isConnected ? "Disconnect" : "Connect") {
                        if sentinelClient.isConnected {
                            sentinelClient.disconnect()
                        } else {
                            sentinelClient.connect()
                        }
                    }
                    .controlSize(.mini)

                    Spacer()

                    // Search
                    TextField("Filter...", text: $searchText)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 80)
                        .controlSize(.mini)

                    // Level picker
                    Picker("", selection: $levelFilter) {
                        ForEach(levels, id: \.self) { level in
                            Text(level).tag(level)
                        }
                    }
                    .labelsHidden()
                    .frame(width: 60)
                    .controlSize(.mini)
                }

                // Symbol filter bar
                if !sentinelClient.activeSymbols.isEmpty {
                    SentinelSymbolFilterView(
                        symbols: sentinelClient.activeSymbols,
                        selectedSymbol: $selectedSymbol
                    )
                }

                // Event list
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 2) {
                            ForEach(filteredEvents) { event in
                                eventRow(event)
                                    .id(event.id)
                                    .onTapGesture {
                                        selectedEvent = event
                                    }
                                    .contentShape(Rectangle())
                            }
                        }
                    }
                    .frame(maxHeight: 200)
                    .onChange(of: sentinelClient.recentEvents.count) { _, _ in
                        if autoScroll, let last = filteredEvents.last {
                            withAnimation {
                                proxy.scrollTo(last.id, anchor: .bottom)
                            }
                        }
                    }
                }

                // Footer
                HStack {
                    if selectedSymbol != nil || levelFilter != "All" || !searchText.isEmpty {
                        Text("\(filteredEvents.count)/\(sentinelClient.recentEvents.count) events")
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                    } else {
                        Text("\(sentinelClient.recentEvents.count) events")
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                    }

                    if !sentinelClient.recentEvents.isEmpty {
                        Button("Clear") {
                            sentinelClient.clearBuffer()
                            selectedSymbol = nil
                        }
                        .controlSize(.mini)
                        .font(.system(size: 9))
                    }

                    Spacer()
                    Toggle("Auto-scroll", isOn: $autoScroll)
                        .toggleStyle(.switch)
                        .controlSize(.mini)
                        .font(.system(size: 9))
                }
            }
        } label: {
            HStack(spacing: 4) {
                Label("Sentinel", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Circle()
                    .fill(sentinelClient.isConnected ? .green : .gray)
                    .frame(width: 6, height: 6)
            }
        }
        .popover(item: $selectedEvent) { event in
            SentinelEventDetailView(
                event: event,
                relatedTasks: relatedTasks(for: event)
            )
        }
    }

    // MARK: - Filtered Events

    private var filteredEvents: [SentinelEvent] {
        sentinelClient.recentEvents.filter { event in
            // Symbol filter
            if let selected = selectedSymbol, event.symbol != selected {
                return false
            }
            // Level filter
            if levelFilter != "All" && event.level != levelFilter {
                return false
            }
            // Text search
            if !searchText.isEmpty {
                let text = searchText.lowercased()
                let matches = (event.symbol?.lowercased().contains(text) ?? false) ||
                    (event.message?.lowercased().contains(text) ?? false) ||
                    event.type.lowercased().contains(text)
                if !matches { return false }
            }
            return true
        }
    }

    /// Find tasks that touch the same symbol as the event.
    private func relatedTasks(for event: SentinelEvent) -> [TaskRecord] {
        guard let symbol = event.symbol, let store = taskStore else { return [] }
        return store.tasks.filter { $0.symbolsTouched.contains(symbol) }
    }

    // MARK: - Event Row

    private func eventRow(_ event: SentinelEvent) -> some View {
        HStack(alignment: .top, spacing: 6) {
            // Timestamp
            Text(event.timestamp, style: .time)
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.tertiary)
                .frame(width: 50, alignment: .leading)

            // Symbol tag (clickable)
            if let symbol = event.symbol {
                Button(action: {
                    if selectedSymbol == symbol {
                        selectedSymbol = nil
                    } else {
                        selectedSymbol = symbol
                    }
                }) {
                    Text(symbol)
                        .font(.system(size: 8, design: .monospaced))
                        .foregroundStyle(.purple)
                        .lineLimit(1)
                        .frame(width: 60, alignment: .leading)
                }
                .buttonStyle(.plain)
            }

            // Level badge
            Text(event.level)
                .font(.system(size: 7, weight: .medium))
                .padding(.horizontal, 3)
                .padding(.vertical, 1)
                .background(RoundedRectangle(cornerRadius: 2).fill(levelColor(event.level).opacity(0.15)))
                .foregroundStyle(levelColor(event.level))

            // Message
            Text(event.message ?? event.type)
                .font(.system(size: 9))
                .lineLimit(2)
                .foregroundStyle(.primary)
        }
        .padding(.vertical, 1)
    }

    private func levelColor(_ level: String) -> Color {
        switch level {
        case "error": return .red
        case "warn": return .orange
        case "info": return .blue
        default: return .secondary
        }
    }
}
