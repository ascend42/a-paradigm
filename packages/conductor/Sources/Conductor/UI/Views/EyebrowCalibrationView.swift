// EyebrowCalibrationView.swift — #eyebrow-calibration
// Fullscreen overlay for calibrating eyebrow detection thresholds.
// 4-step, ~15 seconds. Real-time distance bars.

import SwiftUI

struct EyebrowCalibrationView: View {
    @ObservedObject var calibration: EyebrowCalibration
    let onComplete: (Double, Double) -> Void  // (raiseThreshold, lowerThreshold)
    let onCancel: () -> Void

    @State private var stepComplete = false
    @State private var countdown = 3

    var body: some View {
        VStack(spacing: 24) {
            // Header
            Text("Eyebrow Calibration")
                .font(.title.bold())
                .foregroundStyle(.white)

            Text("Step \(calibration.currentStep.rawValue + 1) of 4")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.7))

            Spacer()

            // Instruction
            VStack(spacing: 12) {
                Image(systemName: stepIcon)
                    .font(.system(size: 48))
                    .foregroundStyle(ConductorTheme.brand)

                Text(stepInstruction)
                    .font(.title3)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)

                if stepComplete {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title)
                        .foregroundStyle(ConductorTheme.healthy)
                }
            }

            // Real-time distance bars
            HStack(spacing: 32) {
                distanceBar(label: "Left", value: calibration.currentLeftDistance)
                distanceBar(label: "Right", value: calibration.currentRightDistance)
            }
            .frame(height: 80)

            Spacer()

            // Actions
            HStack {
                Button("Cancel") {
                    onCancel()
                }
                .keyboardShortcut(.cancelAction)

                Spacer()

                if stepComplete {
                    Button("Next") {
                        stepComplete = false
                        if calibration.isComplete {
                            onComplete(calibration.raiseThreshold, calibration.lowerThreshold)
                        } else {
                            calibration.advanceStep()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(.horizontal, 40)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.85))
    }

    // MARK: - Step Content

    private var stepIcon: String {
        switch calibration.currentStep {
        case .restLeft: return "eyebrow"
        case .raiseLeft: return "arrow.up"
        case .restRight: return "eyebrow"
        case .raiseRight: return "arrow.up"
        }
    }

    private var stepInstruction: String {
        switch calibration.currentStep {
        case .restLeft: return "Relax your face.\nKeep your left eyebrow neutral."
        case .raiseLeft: return "Raise your LEFT eyebrow\nas high as comfortable."
        case .restRight: return "Relax your face again.\nKeep your right eyebrow neutral."
        case .raiseRight: return "Raise your RIGHT eyebrow\nas high as comfortable."
        }
    }

    // MARK: - Distance Bar

    private func distanceBar(label: String, value: Double) -> some View {
        VStack(spacing: 4) {
            Text(label)
                .font(.caption.bold())
                .foregroundStyle(.white.opacity(0.7))

            GeometryReader { geo in
                let height = min(geo.size.height, max(0, value * 1000))
                VStack {
                    Spacer()
                    RoundedRectangle(cornerRadius: 4)
                        .fill(barColor(for: value))
                        .frame(width: 24, height: height)
                }
            }
            .frame(width: 24)

            Text(String(format: "%.3f", value))
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.white.opacity(0.5))
        }
    }

    private func barColor(for value: Double) -> Color {
        if value > 0.04 { return ConductorTheme.healthy }
        if value > 0.02 { return ConductorTheme.degraded }
        return .gray
    }
}
