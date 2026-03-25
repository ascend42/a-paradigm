// LayoutPresetsView.swift — #layout-presets
// Horizontal preset selector strip and keyboard shortcut handling.

import SwiftUI

struct LayoutPresetsView: View {
    @Binding var currentPreset: LayoutPreset?
    let onSelect: (LayoutPreset) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(LayoutPreset.allCases, id: \.rawValue) { preset in
                presetButton(preset)
            }
        }
    }

    private func presetButton(_ preset: LayoutPreset) -> some View {
        Button(action: {
            currentPreset = preset
            onSelect(preset)
        }) {
            VStack(spacing: 2) {
                presetIcon(preset)
                    .frame(width: 24, height: 18)
                Text("⌘\(preset.shortcutIndex)")
                    .font(.system(size: ConductorTheme.fontXS, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(currentPreset == preset ? Color.accentColor.opacity(0.15) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(currentPreset == preset ? Color.accentColor.opacity(0.3) : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .help("\(preset.rawValue) (⌘\(preset.shortcutIndex))")
    }

    // MARK: - Preset Icons (mini layout diagrams)

    @ViewBuilder
    private func presetIcon(_ preset: LayoutPreset) -> some View {
        switch preset {
        case .focused:
            RoundedRectangle(cornerRadius: 2)
                .stroke(Color.secondary, lineWidth: 0.5)

        case .split:
            HStack(spacing: 1) {
                RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
            }

        case .mainSide:
            HStack(spacing: 1) {
                RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                    .frame(width: 14)
                RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                    .frame(width: 9)
            }

        case .grid:
            VStack(spacing: 1) {
                HStack(spacing: 1) {
                    RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                    RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                }
                HStack(spacing: 1) {
                    RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                    RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                }
            }

        case .triple:
            HStack(spacing: 1) {
                RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                    .frame(width: 14)
                VStack(spacing: 1) {
                    RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                    RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                }
                .frame(width: 9)
            }

        case .columns:
            HStack(spacing: 1) {
                RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
                RoundedRectangle(cornerRadius: 1).stroke(Color.secondary, lineWidth: 0.5)
            }
        }
    }
}
