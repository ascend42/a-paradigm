// DividerHandle.swift — #divider-handle
// Draggable split handle between tiling cells with snap feedback.

import SwiftUI

struct DividerHandle: View {
    let divider: DividerFrame
    let onDrag: (CGFloat) -> Void
    let onDragEnd: () -> Void

    /// Snap points for the ratio (triggers haptic-like visual feedback).
    private static let snapPoints: [CGFloat] = [0.25, 0.333, 0.5, 0.667, 0.75]
    /// Distance in points to trigger a snap.
    private static let snapZone: CGFloat = 8

    @State private var isDragging = false
    @State private var isSnapped = false

    var body: some View {
        Rectangle()
            .fill(isDragging ? Color.accentColor.opacity(0.4) : Color.clear)
            .frame(
                width: divider.axis == .horizontal ? handleThickness : nil,
                height: divider.axis == .vertical ? handleThickness : nil
            )
            .contentShape(Rectangle().inset(by: -hitPadding))
            .overlay(dividerLine)
            .gesture(dragGesture)
            .onHover { hovering in
                if hovering {
                    setCursor(for: divider.axis)
                } else {
                    NSCursor.arrow.set()
                }
            }
    }

    // MARK: - Divider Line

    private var dividerLine: some View {
        Group {
            if divider.axis == .horizontal {
                Rectangle()
                    .fill(isDragging ? Color.accentColor : Color.secondary.opacity(0.3))
                    .frame(width: isDragging ? 3 : 2)
                    .scaleEffect(y: isSnapped ? 1.02 : 1.0)
            } else {
                Rectangle()
                    .fill(isDragging ? Color.accentColor : Color.secondary.opacity(0.3))
                    .frame(height: isDragging ? 3 : 2)
                    .scaleEffect(x: isSnapped ? 1.02 : 1.0)
            }
        }
        .animation(.easeOut(duration: 0.15), value: isDragging)
        .animation(.easeOut(duration: 0.1), value: isSnapped)
    }

    // MARK: - Drag Gesture

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                isDragging = true
                let delta: CGFloat
                switch divider.axis {
                case .horizontal:
                    delta = value.translation.width
                case .vertical:
                    delta = -value.translation.height // Invert for macOS Y
                }
                onDrag(delta)
            }
            .onEnded { _ in
                isDragging = false
                isSnapped = false
                onDragEnd()
            }
    }

    // MARK: - Sizing

    /// Visual thickness of the handle.
    private var handleThickness: CGFloat { 8 }

    /// Extra hit target padding around the handle.
    private var hitPadding: CGFloat { 4 }

    // MARK: - Cursor

    private func setCursor(for axis: SplitAxis) {
        switch axis {
        case .horizontal:
            NSCursor.resizeLeftRight.set()
        case .vertical:
            NSCursor.resizeUpDown.set()
        }
    }

    // MARK: - Snap Helpers

    /// Check if a ratio is near a snap point and return the snapped value.
    static func snapRatio(_ ratio: CGFloat, containerSize: CGFloat) -> (ratio: CGFloat, snapped: Bool) {
        for snap in snapPoints {
            let snapPosition = snap * containerSize
            let currentPosition = ratio * containerSize
            if abs(currentPosition - snapPosition) < snapZone {
                return (snap, true)
            }
        }
        return (ratio, false)
    }
}
