// DependencyChecker.swift — #setup-wizard
// Checks and manages external dependency status for the setup wizard.
// Verifies Python 3, MediaPipe/OpenCV, and triggers WhisperKit model download.

import Foundation

/// Checks availability of external dependencies required by Conductor input providers.
@MainActor
final class DependencyChecker: ObservableObject {

    // MARK: - Types

    enum DepStatus: Equatable {
        case pending
        case checking
        case downloading(progress: Double)
        case ready
        case missing(hint: String)
    }

    // MARK: - Published State

    @Published var whisperModel: DepStatus = .pending
    @Published var python3: DepStatus = .pending
    @Published var mediapipe: DepStatus = .pending

    // MARK: - Private

    // MARK: - Python Check

    /// Check whether `python3` is available on the system PATH.
    func checkPython() async {
        python3 = .checking
        ConductorLog.component("setup-wizard").info("Checking for Python 3...")

        let found = await runShellCheck(executable: "/usr/bin/env", arguments: ["python3", "--version"])
        if found {
            python3 = .ready
            ConductorLog.component("setup-wizard").info("Python 3 found")
        } else {
            python3 = .missing(hint: "Install Python 3 via Xcode Command Line Tools or brew install python3")
            ConductorLog.component("setup-wizard").info("Python 3 not found")
        }
    }

    // MARK: - MediaPipe Check

    /// Check whether `mediapipe` and `opencv-python` are importable.
    func checkMediaPipe() async {
        mediapipe = .checking
        ConductorLog.component("setup-wizard").info("Checking for MediaPipe + OpenCV...")

        let found = await runShellCheck(
            executable: "/usr/bin/env",
            arguments: ["python3", "-c", "import mediapipe; import cv2"]
        )
        if found {
            mediapipe = .ready
            ConductorLog.component("setup-wizard").info("MediaPipe + OpenCV found")
        } else {
            mediapipe = .missing(hint: "Install with: pip3 install mediapipe opencv-python")
            ConductorLog.component("setup-wizard").info("MediaPipe + OpenCV not found")
        }
    }

    // MARK: - WhisperKit Model Check

    /// Mark WhisperKit model as ready. Actual download + CoreML compilation
    /// happens lazily on first voice use (WhisperKit.download() hangs during setup).
    func checkWhisperModel() {
        let variant = UserDefaults.standard.string(forKey: "whisperModel") ?? "tiny.en"
        whisperModel = .ready
        ConductorLog.component("setup-wizard")
            .info("WhisperKit model \(variant) selected — will download on first voice use")
    }

    // MARK: - Retry All

    /// Re-check all dependencies that are currently in a missing state.
    func retryMissing() async {
        if case .missing = python3 {
            await checkPython()
        }
        if case .missing = mediapipe {
            await checkMediaPipe()
        }
        if case .missing = whisperModel {
            checkWhisperModel()
        }
    }

    // MARK: - Helpers

    /// Run a shell command and return true if it exits with status 0.
    private func runShellCheck(executable: String, arguments: [String]) async -> Bool {
        await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice

            do {
                try process.run()
                process.waitUntilExit()
                continuation.resume(returning: process.terminationStatus == 0)
            } catch {
                continuation.resume(returning: false)
            }
        }
    }
}
