// VoiceControlCoordinator.swift — #voice-control-coordinator
// State machine coordinating eyebrow-triggered voice recording.
// Manages: WhisperVoiceProvider lifecycle, BufferEngine text insertion,
// error recovery with auto-reset.

import Foundation

/// Coordinates voice recording triggered by eyebrow gestures.
/// State flow: idle → armed → recording → transcribing → readyToSend
@MainActor
final class VoiceControlCoordinator: ObservableObject {

    // MARK: - State

    enum VoiceState: Equatable {
        case idle
        case armed
        case recording
        case transcribing
        case readyToSend
        case error(String)
    }

    @Published private(set) var state: VoiceState = .idle
    @Published private(set) var recordingDuration: TimeInterval = 0

    // MARK: - Dependencies

    private weak var voiceProvider: WhisperVoiceProvider?
    private weak var buffer: BufferEngine?
    private var recordingStartTime: Date?
    private var durationTask: Task<Void, Never>?
    private var errorRecoveryTask: Task<Void, Never>?
    private var transcriptionTask: Task<Void, Never>?

    /// Auto-reset to idle after error (seconds).
    var errorRecoveryTimeout: TimeInterval = 3.0

    // MARK: - Init

    init(voiceProvider: WhisperVoiceProvider? = nil, buffer: BufferEngine? = nil) {
        self.voiceProvider = voiceProvider
        self.buffer = buffer
    }

    /// Wire dependencies after initialization.
    func configure(voiceProvider: WhisperVoiceProvider, buffer: BufferEngine) {
        self.voiceProvider = voiceProvider
        self.buffer = buffer
    }

    // MARK: - Voice Control Actions

    /// Called when left eyebrow raises (arm for recording).
    func arm() {
        guard state == .idle || state == .readyToSend else { return }
        state = .armed
        ConductorLog.flow("voice-dispatch-flow").info("Voice control armed")
    }

    /// Start recording (called when transitioning from armed to recording).
    func startRecording() {
        guard let provider = voiceProvider else {
            state = .error("Voice provider not available")
            scheduleRecovery()
            return
        }

        guard provider.isActive else {
            state = .error("Voice provider not active")
            scheduleRecovery()
            return
        }

        provider.beginRecording()
        state = .recording
        recordingStartTime = .now
        recordingDuration = 0
        startDurationCounter()

        ConductorLog.signal("voice-recording-started")
            .info("Voice recording started via eyebrow trigger")
    }

    /// Stop recording and begin transcription.
    func stopRecording() {
        guard state == .recording, let provider = voiceProvider else { return }

        stopDurationCounter()
        provider.endRecording()
        state = .transcribing

        ConductorLog.signal("voice-recording-stopped")
            .info("Voice recording stopped, transcribing...")

        // Subscribe to the transcription result
        subscribeToTranscription()
    }

    /// Dispatch buffer content to target (called by orchestrator on right eyebrow raise).
    func markReadyToSend() {
        if state == .transcribing {
            // Still transcribing — will auto-transition when done
            return
        }
        state = .readyToSend
    }

    /// Reset to idle state.
    func reset() {
        stopDurationCounter()
        errorRecoveryTask?.cancel()
        transcriptionTask?.cancel()
        state = .idle
        recordingDuration = 0
        recordingStartTime = nil
    }

    // MARK: - Transcription Handling

    private func subscribeToTranscription() {
        guard let provider = voiceProvider, let buffer = buffer else {
            state = .error("Provider or buffer unavailable")
            scheduleRecovery()
            return
        }

        transcriptionTask = Task { [weak self] in
            for await result in provider.transcriptionStream {
                guard !Task.isCancelled else { break }
                guard let self else { break }

                if result.isFinal && !result.text.isEmpty {
                    buffer.append(result.text)
                    self.state = .readyToSend

                    ConductorLog.flow("voice-dispatch-flow")
                        .info("Transcription ready: \(result.text.prefix(60))")

                    ConductorLog.signal("voice-dispatch-complete")
                        .info("Voice pipeline complete, ready to send")
                    break
                }
            }
        }
    }

    // MARK: - Duration Counter

    private func startDurationCounter() {
        durationTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
                guard let self, let start = self.recordingStartTime else { break }
                self.recordingDuration = Date().timeIntervalSince(start)
            }
        }
    }

    private func stopDurationCounter() {
        durationTask?.cancel()
        durationTask = nil
    }

    // MARK: - Error Recovery

    private func scheduleRecovery() {
        errorRecoveryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(self?.errorRecoveryTimeout ?? 3.0))
            guard !Task.isCancelled else { return }
            self?.state = .idle
            ConductorLog.component("voice-control-coordinator")
                .info("Auto-recovered from error state")
        }
    }
}
