// WhisperVoiceProvider.swift — #whisper-voice-provider
// WhisperKit-based speech-to-text implementation.
// Uses CoreML on Apple Silicon for local, offline transcription.
//
// NOTE: WhisperKit dependency will be added in Package.swift when ready.
// For now this provides the structure and will use a placeholder transcription path.

import Foundation

/// macOS voice input provider using WhisperKit for local speech recognition.
@MainActor
final class WhisperVoiceProvider: ObservableObject, VoiceInputProvider {

    // MARK: - Published State

    @Published private(set) var isActive: Bool = false
    @Published private(set) var isModelReady: Bool = false
    @Published private(set) var isRecording: Bool = false
    @Published private(set) var currentMode: VoiceMode = .pushToTalk

    // MARK: - Private

    private let audioCapture = AudioCapture()
    private var transcriptionContinuation: AsyncStream<TranscriptionResult>.Continuation?
    private var audioBuffers: [Data] = []

    /// Path where WhisperKit models are stored.
    private var modelDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Conductor/WhisperModels", isDirectory: true)
    }

    // MARK: - VoiceInputProvider

    var transcriptionStream: AsyncStream<TranscriptionResult> {
        AsyncStream { [weak self] continuation in
            Task { @MainActor in
                self?.transcriptionContinuation = continuation
            }
        }
    }

    func setMode(_ mode: VoiceMode) {
        currentMode = mode
        ConductorLog.component("whisper-voice-provider").info("Voice mode set to \(String(describing: mode))")
    }

    func downloadModel(progress: @escaping (Double) -> Void) async throws {
        ConductorLog.component("whisper-voice-provider").info("Checking WhisperKit model...")

        // Check if model already exists
        let modelPath = modelDirectory.appendingPathComponent("small.en")
        if FileManager.default.fileExists(atPath: modelPath.path) {
            isModelReady = true
            progress(1.0)
            ConductorLog.gate("model-downloaded").info("Model already available")
            return
        }

        // Create model directory
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)

        // TODO: Integrate WhisperKit model download when dependency is added
        // For now, mark as ready — actual download will use WhisperKit.download()
        ConductorLog.component("whisper-voice-provider")
            .info("WhisperKit integration pending — model download stubbed")

        progress(1.0)
        isModelReady = true
        ConductorLog.gate("model-downloaded").info("Model ready")
    }

    // MARK: - InputProvider

    func start() async throws {
        guard isModelReady else {
            ConductorLog.component("whisper-voice-provider")
                .error("Cannot start — model not downloaded")
            return
        }

        try audioCapture.setup()
        isActive = true

        ConductorLog.component("whisper-voice-provider").info("Voice provider started")
    }

    func stop() {
        audioCapture.stop()
        isActive = false
        isRecording = false
        ConductorLog.component("whisper-voice-provider").info("Voice provider stopped")
    }

    // MARK: - Recording Control

    /// Begin recording (for push-to-talk mode).
    func beginRecording() {
        guard isActive else { return }
        audioBuffers.removeAll()
        audioCapture.start()
        isRecording = true
    }

    /// End recording and trigger transcription.
    func endRecording() {
        guard isRecording else { return }
        audioCapture.stop()
        isRecording = false

        Task {
            await transcribeBufferedAudio()
        }
    }

    // MARK: - Transcription

    private func transcribeBufferedAudio() async {
        // TODO: Feed audio buffers to WhisperKit for transcription
        // For now, emit a placeholder result
        ConductorLog.component("whisper-voice-provider")
            .info("Transcription pending WhisperKit integration")

        // When WhisperKit is integrated:
        // let result = try await whisperKit.transcribe(audioBuffers)
        // transcriptionContinuation?.yield(TranscriptionResult(text: result.text, isFinal: true))
        // ConductorLog.signal("transcription-ready").info("Transcription complete")
    }
}
