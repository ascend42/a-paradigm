// TerminalCellView.swift — #terminal-cell-view
// SwiftUI view for a single terminal pane: toolbar + embedded terminal.

import SwiftUI

/// A terminal cell in the tiled workspace grid.
struct TerminalCellView: View {
    let session: TerminalSession
    let appearance: TerminalAppearance
    let isActive: Bool
    var onFocus: (() -> Void)?
    var onClose: (() -> Void)?
    var onProcessTerminated: ((Int32) -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            // Session toolbar
            sessionToolbar

            // Embedded terminal
            TerminalViewRepresentable(
                session: session,
                appearance: appearance,
                onProcessTerminated: onProcessTerminated,
                onBecameFirstResponder: onFocus
            )
        }
        .background(Color(nsColor: appearance.backgroundColor))
        .cornerRadius(6)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(
                    isActive ? Color.accentColor.opacity(0.6) : Color.white.opacity(0.08),
                    lineWidth: isActive ? 2 : 1
                )
        )
        .contentShape(Rectangle())
        .onTapGesture {
            onFocus?()
        }
    }

    // MARK: - Toolbar

    private var sessionToolbar: some View {
        HStack(spacing: 6) {
            // Status dot
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)

            // Project name
            Text(session.label)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(.white.opacity(0.9))
                .lineLimit(1)

            // Status label
            Text(session.status.label)
                .font(.system(size: 10))
                .foregroundStyle(.white.opacity(0.4))

            Spacer()

            // Close button
            Button(action: { onClose?() }) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.4))
            }
            .buttonStyle(.plain)
            .help("Close session")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.white.opacity(0.04))
    }

    private var statusColor: Color {
        switch session.status {
        case .starting: return .yellow
        case .running: return .green
        case .idle: return .blue
        case .exited: return .red
        }
    }
}
