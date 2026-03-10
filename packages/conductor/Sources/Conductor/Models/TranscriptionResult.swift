// TranscriptionResult.swift — #conductor-models
// Voice transcription output from WhisperKit.

import Foundation

/// Result from the voice input provider after processing audio.
struct TranscriptionResult: Equatable {
    /// The transcribed text.
    let text: String

    /// Whether this is a partial (streaming) or final result.
    let isFinal: Bool

    /// Confidence score from the model (0.0–1.0).
    let confidence: Double

    /// Duration of the audio segment that produced this result.
    let audioDuration: TimeInterval

    /// Timestamp when the transcription was produced.
    let timestamp: Date

    init(
        text: String,
        isFinal: Bool = true,
        confidence: Double = 1.0,
        audioDuration: TimeInterval = 0,
        timestamp: Date = .now
    ) {
        self.text = text
        self.isFinal = isFinal
        self.confidence = confidence
        self.audioDuration = audioDuration
        self.timestamp = timestamp
    }
}
