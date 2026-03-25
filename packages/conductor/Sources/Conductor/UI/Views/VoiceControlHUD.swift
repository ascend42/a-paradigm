// VoiceControlHUD.swift — #voice-control-hud
// Compact sidebar widget showing voice control state.
// Visual states: gray mic (idle), yellow pulse (armed),
// red pulse + waveform (recording), spinner (transcribing), green check (ready).

import SwiftUI

struct VoiceControlHUD: View {
    @ObservedObject var coordinator: VoiceControlCoordinator

    var body: some View {
        HStack(spacing: 8) {
            stateIcon
                .frame(width: 24, height: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(stateLabel)
                    .font(.caption.bold())
                    .foregroundStyle(stateColor)

                if case .recording = coordinator.state {
                    Text(formatDuration(coordinator.recordingDuration))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                if case .error(let msg) = coordinator.state {
                    Text(msg)
                        .font(.caption2)
                        .foregroundStyle(ConductorTheme.critical)
                }
            }

            Spacer()

            // Visual indicator
            if case .recording = coordinator.state {
                recordingWaveform
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(stateBackgroundColor)
        )
    }

    // MARK: - State Visuals

    @ViewBuilder
    private var stateIcon: some View {
        switch coordinator.state {
        case .idle:
            Image(systemName: "mic")
                .foregroundStyle(.gray)
        case .armed:
            Image(systemName: "mic.badge.plus")
                .foregroundStyle(ConductorTheme.degraded)
                .symbolEffect(.pulse, isActive: true)
        case .recording:
            Image(systemName: "mic.fill")
                .foregroundStyle(ConductorTheme.critical)
                .symbolEffect(.pulse, isActive: true)
        case .transcribing:
            ProgressView()
                .controlSize(.small)
        case .readyToSend:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(ConductorTheme.healthy)
        case .error:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(ConductorTheme.critical)
        }
    }

    private var stateLabel: String {
        switch coordinator.state {
        case .idle: return "Voice Idle"
        case .armed: return "Armed"
        case .recording: return "Recording"
        case .transcribing: return "Transcribing..."
        case .readyToSend: return "Ready to Send"
        case .error: return "Error"
        }
    }

    private var stateColor: Color {
        switch coordinator.state {
        case .idle: return .secondary
        case .armed: return ConductorTheme.degraded
        case .recording: return ConductorTheme.critical
        case .transcribing: return ConductorTheme.warning
        case .readyToSend: return ConductorTheme.healthy
        case .error: return ConductorTheme.critical
        }
    }

    private var stateBackgroundColor: Color {
        switch coordinator.state {
        case .idle: return Color(nsColor: .controlBackgroundColor)
        case .armed: return ConductorTheme.degraded.opacity(0.1)
        case .recording: return ConductorTheme.critical.opacity(0.1)
        case .transcribing: return ConductorTheme.warning.opacity(0.1)
        case .readyToSend: return ConductorTheme.healthy.opacity(0.1)
        case .error: return ConductorTheme.critical.opacity(0.1)
        }
    }

    // MARK: - Recording Waveform

    private var recordingWaveform: some View {
        HStack(spacing: 2) {
            ForEach(0..<5, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1)
                    .fill(ConductorTheme.critical)
                    .frame(width: 2, height: CGFloat.random(in: 4...16))
                    .animation(
                        .easeInOut(duration: 0.3).repeatForever().delay(Double(i) * 0.1),
                        value: coordinator.recordingDuration
                    )
            }
        }
    }

    // MARK: - Helpers

    private func formatDuration(_ duration: TimeInterval) -> String {
        let seconds = Int(duration) % 60
        let minutes = Int(duration) / 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
