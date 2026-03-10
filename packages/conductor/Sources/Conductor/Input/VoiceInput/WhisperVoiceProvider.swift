// WhisperVoiceProvider.swift — #whisper-voice-provider
// WhisperKit-based speech-to-text implementation.
// Uses CoreML on Apple Silicon for local, offline transcription.

import AVFoundation
import Foundation
@preconcurrency import WhisperKit

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
    private var whisperKit: WhisperKit?
    private var transcriptionContinuation: AsyncStream<TranscriptionResult>.Continuation?
    private var audioSamples: [Float] = []
    private var recordingStartTime: Date?

    /// WhisperKit model variant, configurable via Settings/Setup.
    var modelVariant: String {
        UserDefaults.standard.string(forKey: "whisperModel") ?? "tiny.en"
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
        let variant = self.modelVariant
        ConductorLog.component("whisper-voice-provider").info("Downloading WhisperKit model \(variant)...")

        do {
            // Phase 1: Download model files only (no compilation/loading)
            progress(0.05)
            _ = try await WhisperKit.download(
                variant: variant,
                progressCallback: { progressObj in
                    Task { @MainActor in
                        progress(max(0.05, progressObj.fractionCompleted))
                    }
                }
            )

            // Mark as downloaded — actual WhisperKit init happens lazily on first transcription
            isModelReady = true
            progress(1.0)
            ConductorLog.gate("model-downloaded").info("WhisperKit model \(variant) downloaded")
        } catch {
            ConductorLog.component("whisper-voice-provider")
                .error("WhisperKit download failed: \(error.localizedDescription)")
            throw error
        }
    }

    /// Ensure WhisperKit is initialized (called lazily before first transcription).
    private func ensureLoaded() async throws {
        guard whisperKit == nil else { return }
        let variant = self.modelVariant

        ConductorLog.component("whisper-voice-provider").info("Loading WhisperKit \(variant)...")
        let kit = try await WhisperKit(
            model: variant,
            verbose: false,
            logLevel: .error,
            prewarm: false,
            load: true,
            download: false // Already downloaded
        )
        self.whisperKit = kit
        ConductorLog.component("whisper-voice-provider").info("WhisperKit loaded and ready")
    }

    // MARK: - InputProvider

    func start() async throws {
        guard isModelReady else {
            ConductorLog.component("whisper-voice-provider")
                .error("Cannot start — model not downloaded")
            return
        }

        try audioCapture.setup()

        // Wire audio buffer callback to accumulate float samples
        audioCapture.onAudioBuffer = { [weak self] sampleBuffer in
            let floats = Self.extractFloatSamples(from: sampleBuffer)
            Task { @MainActor [weak self] in
                if self?.isRecording == true {
                    self?.audioSamples.append(contentsOf: floats)
                }
            }
        }

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
        audioSamples.removeAll()
        recordingStartTime = .now
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
        // Lazy-load WhisperKit on first transcription
        do {
            try await ensureLoaded()
        } catch {
            ConductorLog.component("whisper-voice-provider")
                .error("Failed to load WhisperKit: \(error.localizedDescription)")
            return
        }

        guard let kit = whisperKit else {
            ConductorLog.component("whisper-voice-provider")
                .error("Cannot transcribe — WhisperKit not initialized")
            return
        }

        let samples = audioSamples
        let startTime = recordingStartTime ?? .now
        audioSamples.removeAll()

        guard !samples.isEmpty else {
            ConductorLog.component("whisper-voice-provider").info("No audio samples to transcribe")
            return
        }

        let audioDuration = TimeInterval(samples.count) / 16000.0
        ConductorLog.component("whisper-voice-provider")
            .info("Transcribing \(String(format: "%.1f", audioDuration))s of audio...")

        do {
            let wkResults = try await kit.transcribe(audioArray: samples)

            let text = wkResults.compactMap { $0.text }.joined(separator: " ").trimmingCharacters(in: .whitespaces)

            guard !text.isEmpty else {
                ConductorLog.component("whisper-voice-provider").info("Transcription returned empty text")
                return
            }

            // Compute average confidence from segments
            let allSegments = wkResults.flatMap { $0.segments }
            let avgConfidence: Double = allSegments.isEmpty ? 1.0 :
                Double(allSegments.map { 1.0 - Double($0.noSpeechProb) }.reduce(0, +)) / Double(allSegments.count)

            let result = TranscriptionResult(
                text: text,
                isFinal: true,
                confidence: avgConfidence,
                audioDuration: audioDuration,
                timestamp: startTime
            )

            transcriptionContinuation?.yield(result)
            ConductorLog.signal("transcription-ready")
                .info("Transcribed: \"\(text.prefix(80))\" (confidence: \(String(format: "%.2f", avgConfidence)))")
        } catch {
            ConductorLog.component("whisper-voice-provider")
                .error("Transcription failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Audio Conversion

    /// Convert a CMSampleBuffer from AVCaptureSession into 16kHz mono Float samples for WhisperKit.
    private static func extractFloatSamples(from sampleBuffer: CMSampleBuffer) -> [Float] {
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else {
            return []
        }

        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer)

        guard status == kCMBlockBufferNoErr, let data = dataPointer else {
            return []
        }

        // Get the audio format to determine sample rate and format
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc)?.pointee else {
            return []
        }

        let sampleCount = length / MemoryLayout<Int16>.size

        // Convert Int16 PCM to Float (common capture format)
        if asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0 {
            // Already float samples
            let floatCount = length / MemoryLayout<Float>.size
            let floatBuffer = UnsafeRawPointer(data).bindMemory(to: Float.self, capacity: floatCount)
            return Array(UnsafeBufferPointer(start: floatBuffer, count: floatCount))
        } else {
            // Int16 PCM → Float normalized to [-1.0, 1.0]
            let int16Buffer = UnsafeRawPointer(data).bindMemory(to: Int16.self, capacity: sampleCount)
            return (0..<sampleCount).map { Float(int16Buffer[$0]) / Float(Int16.max) }
        }

        // Note: WhisperKit internally handles resampling to 16kHz if needed,
        // but AVCaptureSession with .high preset typically captures at 48kHz.
        // WhisperKit's AudioProcessor handles the conversion.
    }
}
