// VoiceInputProvider.swift — ~platform-abstracted
// Protocol for speech-to-text input.
// macOS: WhisperKit (CoreML, Apple Silicon) — Sprint 2
// Windows: whisper.cpp or ONNX Whisper (future)

import Foundation

/// Platform-abstracted voice input provider.
/// Implementations convert microphone audio into transcription results.
@MainActor
protocol VoiceInputProvider: InputProvider {
    /// Async stream of transcription results (partial and final).
    var transcriptionStream: AsyncStream<TranscriptionResult> { get }

    /// Set the voice activation mode.
    func setMode(_ mode: VoiceMode)

    /// Whether the speech model is downloaded and ready.
    var isModelReady: Bool { get }

    /// Download the speech model if not already present.
    /// Reports progress via the callback (0.0–1.0).
    func downloadModel(progress: @escaping (Double) -> Void) async throws
}
