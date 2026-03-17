// CellFooterView.swift — #cell-footer
// Per-cell status footer showing symbols, files, and agent info.

import SwiftUI

struct CellFooterView: View {
    var symbols: [String] = []
    var filesModified: Int = 0
    var agentStatus: String?

    var body: some View {
        HStack(spacing: 8) {
            // Symbols
            if !symbols.isEmpty {
                HStack(spacing: 2) {
                    Image(systemName: "number")
                        .font(.system(size: 7))
                    Text(symbols.prefix(3).joined(separator: ", "))
                        .lineLimit(1)
                }
                .font(.system(size: 8))
                .foregroundStyle(.purple.opacity(0.8))
            }

            // Files
            if filesModified > 0 {
                HStack(spacing: 2) {
                    Image(systemName: "doc")
                        .font(.system(size: 7))
                    Text("\(filesModified)")
                }
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
            }

            // Agent
            if let status = agentStatus {
                HStack(spacing: 2) {
                    Circle()
                        .fill(.green)
                        .frame(width: 4, height: 4)
                    Text(status)
                }
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(.horizontal, 8)
        .frame(height: 18)
    }
}
