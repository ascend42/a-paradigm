// SentinelSymbolFilterView.swift — #sentinel-symbol-filter
// Horizontal symbol chip filter bar for SentinelLiveView.

import SwiftUI

struct SentinelSymbolFilterView: View {
    let symbols: [String]
    @Binding var selectedSymbol: String?

    /// Show top N symbols as chips.
    private let maxChips = 10

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                // "All" chip
                chipButton(label: "All", isSelected: selectedSymbol == nil) {
                    selectedSymbol = nil
                }

                // Top symbols
                ForEach(symbols.prefix(maxChips), id: \.self) { symbol in
                    chipButton(label: symbol, isSelected: selectedSymbol == symbol) {
                        if selectedSymbol == symbol {
                            selectedSymbol = nil
                        } else {
                            selectedSymbol = symbol
                        }
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func chipButton(label: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: ConductorTheme.fontXS, design: .monospaced))
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(
                    Capsule().fill(isSelected ? ConductorTheme.symphony.opacity(0.25) : Color.secondary.opacity(0.1))
                )
                .foregroundStyle(isSelected ? ConductorTheme.symphony : .secondary)
        }
        .buttonStyle(.plain)
    }
}
