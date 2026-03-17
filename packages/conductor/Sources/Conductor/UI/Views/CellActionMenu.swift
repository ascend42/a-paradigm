// CellActionMenu.swift — #cell-action-menu
// Context actions for workspace cells: split, maximize, close, launch.

import SwiftUI

struct CellActionMenu: View {
    let cellId: String
    let isEmpty: Bool
    let isMaximized: Bool
    let onSplitHorizontal: () -> Void
    let onSplitVertical: () -> Void
    let onMaximize: () -> Void
    let onClose: () -> Void
    let onLaunch: () -> Void

    var body: some View {
        if isEmpty {
            emptyMenu
        } else {
            instanceMenu
        }
    }

    // MARK: - Empty Cell Menu

    private var emptyMenu: some View {
        Menu {
            Button(action: onLaunch) {
                Label("Launch Instance Here", systemImage: "terminal")
            }
            Divider()
            Button(action: onClose) {
                Label("Remove Cell", systemImage: "xmark")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .frame(width: 20, height: 20)
                .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
    }

    // MARK: - Instance Cell Menu

    private var instanceMenu: some View {
        Menu {
            Section("Layout") {
                Button(action: onSplitHorizontal) {
                    Label("Split Left/Right", systemImage: "rectangle.split.2x1")
                }
                Button(action: onSplitVertical) {
                    Label("Split Top/Bottom", systemImage: "rectangle.split.1x2")
                }
                Divider()
                Button(action: onMaximize) {
                    Label(isMaximized ? "Restore" : "Maximize", systemImage: isMaximized ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                }
            }
            Divider()
            Section("Instance") {
                Button(role: .destructive, action: onClose) {
                    Label("Close Instance", systemImage: "xmark.circle")
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .frame(width: 20, height: 20)
                .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
    }
}

// MARK: - Empty Cell Placeholder

struct EmptyCellView: View {
    let onLaunch: () -> Void
    let onDrop: ((String) -> Void)?

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "plus.rectangle.on.rectangle")
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)

            Text("Add Instance")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)

            Text("Drop project or click +")
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)

            Button(action: onLaunch) {
                Label("Launch", systemImage: "terminal")
                    .font(.system(size: 10))
            }
            .controlSize(.small)
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
