// CellChromeView.swift — #cell-chrome
// Per-cell overlay with header bar, border, and status indicators.
// Renders chrome around the transparent area where the terminal window sits.

import SwiftUI

struct CellChromeView: View {
    let cellFrame: CellFrame
    var isGazeTargeted: Bool = false
    var status: CellStatus = .idle
    var progress: Int = 0
    var onSplit: ((SplitAxis) -> Void)?
    var onClose: (() -> Void)?
    var onMaximize: (() -> Void)?

    /// Height of the cell header bar.
    private let headerHeight: CGFloat = 28
    /// Height of the optional cell footer.
    private let footerHeight: CGFloat = 20

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Border
            RoundedRectangle(cornerRadius: 6)
                .stroke(borderColor, lineWidth: isGazeTargeted ? 2 : 1)

            VStack(spacing: 0) {
                // Header bar
                headerBar
                    .frame(height: headerHeight)
                    .background(.ultraThinMaterial)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 6, topTrailingRadius: 6))

                Spacer()
            }
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack(spacing: 6) {
            // Project name
            if let label = cellFrame.label {
                Text(label)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
            } else if cellFrame.instanceId == nil {
                Text("Empty")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            } else {
                Text("Instance")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }

            // Status badge
            if cellFrame.instanceId != nil {
                statusBadge
            }

            // Progress
            if status == .implementing && progress > 0 {
                Text("\(progress)%")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Actions (only for non-empty cells)
            if cellFrame.instanceId != nil {
                // Split menu
                Menu {
                    Button("Split Horizontal") { onSplit?(.horizontal) }
                    Button("Split Vertical") { onSplit?(.vertical) }
                } label: {
                    Image(systemName: "rectangle.split.2x1")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
                .frame(width: 20)

                // Maximize
                Button(action: { onMaximize?() }) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)

                // Close
                Button(action: { onClose?() }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
            } else {
                // Empty cell: just show + button
                Button(action: { /* handled by parent */ }) {
                    Image(systemName: "plus")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
            }
        }
        .padding(.horizontal, 8)
    }

    // MARK: - Status

    private var statusBadge: some View {
        HStack(spacing: 3) {
            Circle()
                .fill(status.color)
                .frame(width: 6, height: 6)
            Text(status.label)
                .font(.system(size: 8, weight: .medium))
                .foregroundStyle(status.color)
        }
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(Capsule().fill(status.color.opacity(0.1)))
    }

    private var borderColor: Color {
        if isGazeTargeted { return .green }
        switch status {
        case .blocked: return .red.opacity(0.5)
        case .implementing: return .blue.opacity(0.3)
        default: return .secondary.opacity(0.2)
        }
    }
}

// MARK: - Cell Status

enum CellStatus: String {
    case idle
    case implementing
    case blocked
    case complete
    case processing

    var label: String {
        switch self {
        case .idle: return "idle"
        case .implementing: return "implementing"
        case .blocked: return "blocked"
        case .complete: return "complete"
        case .processing: return "processing"
        }
    }

    var color: Color {
        switch self {
        case .idle: return .secondary
        case .implementing: return .blue
        case .blocked: return .red
        case .complete: return .green
        case .processing: return .orange
        }
    }
}
