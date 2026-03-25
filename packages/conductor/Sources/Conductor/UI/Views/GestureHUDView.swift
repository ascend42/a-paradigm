// GestureHUDView.swift — #gesture-hud
// Visual feedback overlay showing detected hand state and gesture actions.

import SwiftUI

struct GestureHUDView: View {
    @ObservedObject var gestureProvider: VisionGestureProvider

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Gestures", systemImage: "hand.raised")
                    .font(.subheadline.bold())
                    .foregroundStyle(.secondary)

                Spacer()

                // Active indicator
                Circle()
                    .fill(gestureProvider.isActive ? .green : .gray)
                    .frame(width: 8, height: 8)
                    .accessibilityLabel(gestureProvider.isActive ? "Gesture tracking active" : "Gesture tracking inactive")
            }

            if gestureProvider.isActive {
                handStateView
            } else {
                Text("Camera not active")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    @ViewBuilder
    private var handStateView: some View {
        HStack(spacing: 12) {
            gestureIcon
                .font(.title2)
                .frame(width: 36, height: 36)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(gestureColor.opacity(0.15))
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(gestureLabel)
                    .font(.caption.bold())
                Text(gestureDescription)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var gestureIcon: some View {
        Group {
            switch gestureProvider.currentHandState {
            case .open:
                Image(systemName: "hand.raised.fill")
                    .foregroundStyle(.blue)
            case .fist:
                Image(systemName: "hand.raised.slash.fill")
                    .foregroundStyle(.orange)
            case .pinch:
                Image(systemName: "hand.pinch")
                    .foregroundStyle(.red)
            case .twoFingerTap:
                Image(systemName: "hand.tap.fill")
                    .foregroundStyle(.green)
            case .swipeLeft:
                Image(systemName: "hand.point.left.fill")
                    .foregroundStyle(.cyan)
            case .swipeRight:
                Image(systemName: "hand.point.right.fill")
                    .foregroundStyle(.cyan)
            case .none:
                Image(systemName: "hand.raised")
                    .foregroundStyle(.gray)
            }
        }
    }

    private var gestureLabel: String {
        switch gestureProvider.currentHandState {
        case .open: return "Open Palm"
        case .fist: return "Fist"
        case .pinch: return "Pinch"
        case .twoFingerTap: return "Two-Finger Tap"
        case .swipeLeft: return "Swipe Left"
        case .swipeRight: return "Swipe Right"
        case .none: return "Waiting…"
        }
    }

    private var gestureDescription: String {
        switch gestureProvider.currentHandState {
        case .open: return "Redo"
        case .fist: return "Undo"
        case .pinch: return "Delete"
        case .twoFingerTap: return "Send to target"
        case .swipeLeft: return "Cursor left"
        case .swipeRight: return "Cursor right"
        case .none: return "Show your hand"
        }
    }

    private var gestureColor: Color {
        switch gestureProvider.currentHandState {
        case .open: return .blue
        case .fist: return .orange
        case .pinch: return .red
        case .twoFingerTap: return .green
        case .swipeLeft, .swipeRight: return .cyan
        case .none: return .gray
        }
    }
}
