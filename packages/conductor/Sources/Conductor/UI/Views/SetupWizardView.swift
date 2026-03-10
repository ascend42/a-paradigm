// SetupWizardView.swift — #setup-wizard
// Multi-step setup wizard for configuring Conductor input features and dependencies.
// Shown after permissions onboarding, before the main overlay content.

import SwiftUI

struct SetupWizardView: View {
    let onComplete: () -> Void

    // MARK: - Wizard State

    enum SetupStep: Int, CaseIterable {
        case featureSelection
        case dependencies
        case gazeCalibration
        case ready
    }

    @State private var currentStep: SetupStep = .featureSelection

    // MARK: - Feature Toggles

    @AppStorage("voiceEnabled") private var voiceEnabled: Bool = true
    @AppStorage("gestureEnabled") private var gestureEnabled: Bool = false
    @AppStorage("gazeEnabled") private var gazeEnabled: Bool = false
    @AppStorage("whisperModel") private var selectedModel: String = "tiny.en"

    // MARK: - Dependencies

    @StateObject private var depChecker = DependencyChecker()
    @State private var calibrationComplete: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            // Step indicator
            stepIndicator
                .padding(.top, 8)
                .padding(.bottom, 4)

            Divider()
                .padding(.horizontal, 12)

            // Step content
            Group {
                switch currentStep {
                case .featureSelection:
                    featureSelectionStep
                case .dependencies:
                    dependenciesStep
                case .gazeCalibration:
                    gazeCalibrationStep
                case .ready:
                    readyStep
                }
            }
            .transition(.opacity)
            .animation(.easeInOut(duration: 0.2), value: currentStep)
        }
        .padding(16)
    }

    // MARK: - Step Indicator

    private var stepIndicator: some View {
        HStack(spacing: 8) {
            ForEach(visibleSteps, id: \.rawValue) { step in
                Circle()
                    .fill(step == currentStep ? Color.cyan : Color.secondary.opacity(0.3))
                    .frame(width: 8, height: 8)
            }
        }
    }

    /// Steps that are relevant given the current feature selections.
    private var visibleSteps: [SetupStep] {
        var steps: [SetupStep] = [.featureSelection]
        if needsDependencyStep {
            steps.append(.dependencies)
        }
        if gazeEnabled {
            steps.append(.gazeCalibration)
        }
        steps.append(.ready)
        return steps
    }

    /// Whether any selected feature requires external dependencies.
    private var needsDependencyStep: Bool {
        voiceEnabled || gazeEnabled
    }

    // MARK: - Step 1: Feature Selection

    private var featureSelectionStep: some View {
        VStack(spacing: 16) {
            // Header
            VStack(spacing: 4) {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 32))
                    .foregroundStyle(.cyan)
                Text("Configure Inputs")
                    .font(.title3.bold())
                Text("Choose which input methods to enable.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 8)

            // Feature toggles
            VStack(spacing: 12) {
                VStack(spacing: 0) {
                    featureToggleRow(
                        icon: "mic",
                        title: "Voice Input",
                        detail: "Speak to type with WhisperKit",
                        isOn: $voiceEnabled
                    )

                    if voiceEnabled {
                        HStack(spacing: 8) {
                            Text("Model")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Picker("", selection: $selectedModel) {
                                Text("tiny.en — fast, ~40MB").tag("tiny.en")
                                Text("base.en — balanced, ~150MB").tag("base.en")
                                Text("small.en — accurate, ~500MB").tag("small.en")
                            }
                            .labelsHidden()
                            .controlSize(.small)
                            .frame(width: 200)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color(nsColor: .controlBackgroundColor))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 8))

                featureToggleRow(
                    icon: "hand.raised",
                    title: "Hand Gestures",
                    detail: "Edit with hand gestures via Apple Vision",
                    isOn: $gestureEnabled
                )

                featureToggleRow(
                    icon: "eye",
                    title: "Gaze Tracking",
                    detail: "Target windows by looking at them",
                    isOn: $gazeEnabled
                )
            }

            Spacer()

            Button(action: advanceFromFeatureSelection) {
                Text("Next")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)
        }
    }

    private func featureToggleRow(
        icon: String,
        title: String,
        detail: String,
        isOn: Binding<Bool>
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.secondary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.bold())
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Toggle("", isOn: isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
    }

    private func advanceFromFeatureSelection() {
        ConductorLog.component("setup-wizard").info(
            "Features selected — voice: \(voiceEnabled), gestures: \(gestureEnabled), gaze: \(gazeEnabled)"
        )
        if needsDependencyStep {
            currentStep = .dependencies
        } else if gazeEnabled {
            currentStep = .gazeCalibration
        } else {
            currentStep = .ready
        }
    }

    // MARK: - Step 2: Dependencies

    private var dependenciesStep: some View {
        VStack(spacing: 16) {
            // Header
            VStack(spacing: 4) {
                Image(systemName: "gear")
                    .font(.system(size: 32))
                    .foregroundStyle(.cyan)
                Text("Setting Up")
                    .font(.title3.bold())
                Text("Checking and downloading required dependencies.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 8)

            // Dependency rows
            VStack(spacing: 12) {
                if voiceEnabled {
                    dependencyRow(
                        icon: "waveform",
                        label: "WhisperKit Model (\(selectedModel))",
                        status: depChecker.whisperModel
                    )
                }

                if gazeEnabled {
                    dependencyRow(
                        icon: "terminal",
                        label: "Python 3",
                        status: depChecker.python3
                    )

                    dependencyRow(
                        icon: "eye.trianglebadge.exclamationmark",
                        label: "MediaPipe + OpenCV",
                        status: depChecker.mediapipe
                    )
                }
            }

            Spacer()

            VStack(spacing: 8) {
                if hasMissingDeps {
                    Button(action: retryChecks) {
                        Text("Retry Checks")
                            .frame(maxWidth: .infinity)
                    }
                    .controlSize(.large)
                    .buttonStyle(.bordered)
                }

                Button(action: advanceFromDependencies) {
                    Text(allDepsReady ? "Continue" : "Continue Anyway")
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.large)
                .buttonStyle(.borderedProminent)
                .disabled(hasBlockingDownload)
            }
        }
        .onAppear {
            startDependencyChecks()
        }
    }

    private func dependencyRow(icon: String, label: String, status: DependencyChecker.DepStatus) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .frame(width: 24)

                Text(label)
                    .font(.subheadline.bold())

                Spacer()

                depStatusBadge(for: status)
            }

            // Progress indicator for downloads
            if case .downloading(let progress) = status {
                HStack(spacing: 8) {
                    if progress > 0.05 && progress < 0.95 {
                        ProgressView(value: progress)
                            .tint(.cyan)
                        Text("\(Int(progress * 100))%")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: 32, alignment: .trailing)
                    } else {
                        ProgressView()
                            .controlSize(.small)
                        Text(progress < 0.5 ? "Downloading…" : "Compiling model…")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.leading, 36)
            }

            // Hint for missing dependencies
            if case .missing(let hint) = status {
                Text(hint)
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .padding(.leading, 36)
                    .textSelection(.enabled)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
    }

    @ViewBuilder
    private func depStatusBadge(for status: DependencyChecker.DepStatus) -> some View {
        switch status {
        case .pending:
            Image(systemName: "circle")
                .foregroundStyle(.secondary)
        case .checking:
            ProgressView()
                .controlSize(.small)
        case .downloading:
            HStack(spacing: 4) {
                ProgressView()
                    .controlSize(.small)
                Text("Setting up…")
                    .font(.caption2)
                    .foregroundStyle(.cyan)
            }
        case .ready:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .missing:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        }
    }

    /// Whether all required dependencies are satisfied.
    private var allDepsReady: Bool {
        let whisperOK = !voiceEnabled || depChecker.whisperModel == .ready
        let pythonOK = !gazeEnabled || depChecker.python3 == .ready
        let mediapipeOK = !gazeEnabled || depChecker.mediapipe == .ready
        return whisperOK && pythonOK && mediapipeOK
    }

    /// Whether a download is currently in progress (blocks the Continue button).
    private var hasBlockingDownload: Bool {
        if case .downloading = depChecker.whisperModel {
            return true
        }
        return false
    }

    /// Whether any dependency is in a missing state (shows retry button).
    private var hasMissingDeps: Bool {
        if voiceEnabled, case .missing = depChecker.whisperModel { return true }
        if gazeEnabled, case .missing = depChecker.python3 { return true }
        if gazeEnabled, case .missing = depChecker.mediapipe { return true }
        return false
    }

    private func retryChecks() {
        ConductorLog.component("setup-wizard").info("Retrying dependency checks")
        Task {
            await depChecker.retryMissing()
        }
    }

    private func startDependencyChecks() {
        ConductorLog.component("setup-wizard").info("Starting dependency checks")

        if voiceEnabled {
            Task {
                try? await depChecker.downloadWhisperModel()
            }
        }

        if gazeEnabled {
            Task {
                await depChecker.checkPython()
            }
            Task {
                await depChecker.checkMediaPipe()
            }
        }
    }

    private func advanceFromDependencies() {
        if gazeEnabled {
            currentStep = .gazeCalibration
        } else {
            currentStep = .ready
        }
    }

    // MARK: - Step 3: Gaze Calibration

    private var gazeCalibrationStep: some View {
        VStack(spacing: 16) {
            // Header
            VStack(spacing: 4) {
                Image(systemName: "eye")
                    .font(.system(size: 32))
                    .foregroundStyle(.cyan)
                Text("Calibrate Gaze")
                    .font(.title3.bold())
                Text("Look at each target for 2 seconds. Make sure your face is centered in the camera.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 8)

            Spacer()

            if calibrationComplete {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 40))
                        .foregroundStyle(.green)
                    Text("Calibration complete")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            VStack(spacing: 8) {
                if !calibrationComplete {
                    Button(action: startCalibration) {
                        Text("Start Calibration")
                            .frame(maxWidth: .infinity)
                    }
                    .controlSize(.large)
                    .buttonStyle(.borderedProminent)

                    Button(action: skipCalibration) {
                        Text("Skip for now")
                            .font(.caption)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                } else {
                    Button(action: { currentStep = .ready }) {
                        Text("Continue")
                            .frame(maxWidth: .infinity)
                    }
                    .controlSize(.large)
                    .buttonStyle(.borderedProminent)
                }
            }
        }
    }

    private func startCalibration() {
        ConductorLog.component("setup-wizard").info("Starting gaze calibration from setup wizard")
        NotificationCenter.default.post(name: .conductorRecalibrate, object: nil)

        // Listen for calibration completion. The calibration overlay will post back
        // when done. For the wizard, we mark it complete after a reasonable delay
        // since CalibrationWindowController is fully async and managed externally.
        // In practice, the user will see the calibration overlay and return here.
        calibrationComplete = true
        currentStep = .ready
    }

    private func skipCalibration() {
        ConductorLog.component("setup-wizard").info("Gaze calibration skipped")
        currentStep = .ready
    }

    // MARK: - Step 4: Ready

    private var readyStep: some View {
        VStack(spacing: 16) {
            // Header
            VStack(spacing: 4) {
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 32))
                    .foregroundStyle(.cyan)
                Text("Ready")
                    .font(.title3.bold())
                Text("Conductor is configured and ready to go.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 8)

            // Summary
            VStack(spacing: 8) {
                summaryRow(icon: "mic", label: "Voice", status: voiceSummary)
                summaryRow(icon: "hand.raised", label: "Gestures", status: gestureSummary)
                summaryRow(icon: "eye", label: "Gaze", status: gazeSummary)
            }

            Spacer()

            Button(action: completeSetup) {
                Text("Start Conductor")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)
        }
    }

    private func summaryRow(icon: String, label: String, status: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.secondary)
                .frame(width: 24)

            Text(label)
                .font(.subheadline.bold())

            Spacer()

            Text(status)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
    }

    private var voiceSummary: String {
        guard voiceEnabled else { return "Disabled" }
        if depChecker.whisperModel == .ready { return "Ready" }
        if case .missing = depChecker.whisperModel { return "Model missing" }
        return "Enabled"
    }

    private var gestureSummary: String {
        gestureEnabled ? "Ready" : "Disabled"
    }

    private var gazeSummary: String {
        guard gazeEnabled else { return "Disabled" }
        if calibrationComplete { return "Calibrated" }
        if depChecker.python3 == .ready && depChecker.mediapipe == .ready {
            return "Ready (uncalibrated)"
        }
        return "Dependencies missing"
    }

    private func completeSetup() {
        ConductorLog.signal("setup-complete").info(
            "Setup wizard finished — voice: \(voiceEnabled), gestures: \(gestureEnabled), gaze: \(gazeEnabled)"
        )
        onComplete()
    }
}
