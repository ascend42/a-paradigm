// InputStatusView.swift — #input-status
// Live input modality status monitor.
// Shows real-time feedback for gaze, eyebrows, voice, and gestures.

import SwiftUI

struct InputStatusView: View {
    @ObservedObject var orchestrator: InputOrchestrator

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label("Input Status", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.subheadline.bold())
                    .foregroundStyle(.secondary)
                Spacer()
            }

            VStack(spacing: 4) {
                gazeStatus
                eyebrowStatus
                voiceStatus
                gestureStatus
            }
        }
    }

    // MARK: - Gaze

    private var gazeStatus: some View {
        let provider = orchestrator.gazeProvider
        let active = provider?.isActive ?? false
        let calibrated = provider?.isCalibrated ?? false

        return statusRow(
            icon: "eye.fill",
            label: "Gaze",
            color: active ? (calibrated ? .green : .yellow) : .gray,
            detail: gazeDetail(active: active, calibrated: calibrated)
        )
    }

    private func gazeDetail(active: Bool, calibrated: Bool) -> String {
        if !active { return "Off" }
        if !calibrated { return "Active — not calibrated" }
        if let point = orchestrator.gazeRouter.currentGazePoint {
            return String(format: "Tracking (%.0f, %.0f)", point.x, point.y)
        }
        return "Active — waiting for face"
    }

    // MARK: - Eyebrows

    private var eyebrowStatus: some View {
        let enabled = orchestrator.eyebrowEnabled
        let detector = orchestrator.eyebrowDetector
        let hasData = detector.smoothedLeft > 0 || detector.smoothedRight > 0

        return statusRow(
            icon: "eyebrow",
            label: "Eyebrows",
            color: enabled ? (hasData ? .green : .yellow) : .gray,
            detail: eyebrowDetail(enabled: enabled, detector: detector)
        )
    }

    private func eyebrowDetail(enabled: Bool, detector: EyebrowDetector) -> String {
        if !enabled { return "Off" }
        if detector.smoothedLeft == 0 && detector.smoothedRight == 0 {
            return "Active — no face data"
        }
        return String(format: "L: %.3f  R: %.3f", detector.smoothedLeft, detector.smoothedRight)
    }

    // MARK: - Voice

    private var voiceStatus: some View {
        let active = orchestrator.voiceActive
        let provider = orchestrator.voiceProvider
        let modelReady = provider?.isModelReady ?? false
        let recording = provider?.isRecording ?? false

        return VStack(alignment: .leading, spacing: 2) {
            statusRow(
                icon: "mic.fill",
                label: "Voice",
                color: active ? (recording ? .red : .green) : .gray,
                detail: voiceDetail(active: active, modelReady: modelReady, recording: recording)
            )

            // Last transcription
            if active && !orchestrator.lastTranscription.isEmpty {
                Text(orchestrator.lastTranscription)
                    .font(.caption2.italic())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .padding(.leading, 24)
            }
        }
    }

    private func voiceDetail(active: Bool, modelReady: Bool, recording: Bool) -> String {
        if !active { return "Off" }
        if !modelReady { return "Loading model..." }
        if recording { return "Recording..." }
        return "Ready"
    }

    // MARK: - Gestures

    private var gestureStatus: some View {
        let provider = orchestrator.gestureProvider
        let active = provider?.isActive ?? false
        let handState = provider?.currentHandState ?? .none

        return statusRow(
            icon: "hand.raised.fill",
            label: "Gestures",
            color: active ? (handState != .none ? .green : .yellow) : .gray,
            detail: gestureDetail(active: active, handState: handState)
        )
    }

    private func gestureDetail(active: Bool, handState: HandState) -> String {
        if !active { return "Off" }
        switch handState {
        case .open: return "Hand detected — Open"
        case .fist: return "Hand detected — Fist"
        case .pinch: return "Hand detected — Pinch"
        case .twoFingerTap: return "Hand detected — Two-finger"
        case .swipeLeft: return "Hand detected — Swipe left"
        case .swipeRight: return "Hand detected — Swipe right"
        case .none: return "Active — no hand"
        }
    }

    // MARK: - Row Helper

    private func statusRow(icon: String, label: String, color: Color, detail: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 10))
                .foregroundStyle(color)
                .frame(width: 16)

            Text(label)
                .font(.caption.bold())
                .frame(width: 60, alignment: .leading)

            Circle()
                .fill(color)
                .frame(width: 6, height: 6)

            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Spacer()
        }
        .padding(.vertical, 2)
    }
}
