// AudioCapture.swift — #audio-capture
// AVCaptureSession microphone pipeline for feeding audio to WhisperKit.

import AVFoundation

/// Captures audio from the microphone and provides raw audio buffers.
final class AudioCapture: NSObject {
    private var captureSession: AVCaptureSession?
    private var audioOutput: AVCaptureAudioDataOutput?
    private let outputQueue = DispatchQueue(label: "com.a-company.conductor.audio-capture")

    /// Callback for received audio buffers.
    var onAudioBuffer: ((CMSampleBuffer) -> Void)?

    /// Whether capture is currently active.
    private(set) var isCapturing = false

    // MARK: - Setup

    func setup() throws {
        let session = AVCaptureSession()
        session.sessionPreset = .high

        // Get default microphone
        guard let microphone = AVCaptureDevice.default(for: .audio) else {
            throw AudioCaptureError.noMicrophoneAvailable
        }

        let input = try AVCaptureDeviceInput(device: microphone)
        guard session.canAddInput(input) else {
            throw AudioCaptureError.cannotAddInput
        }
        session.addInput(input)

        let output = AVCaptureAudioDataOutput()
        output.setSampleBufferDelegate(self, queue: outputQueue)
        guard session.canAddOutput(output) else {
            throw AudioCaptureError.cannotAddOutput
        }
        session.addOutput(output)

        self.captureSession = session
        self.audioOutput = output

        ConductorLog.component("audio-capture").info("Audio pipeline configured")
    }

    // MARK: - Control

    func start() {
        guard !isCapturing else { return }
        captureSession?.startRunning()
        isCapturing = true
        ConductorLog.component("audio-capture").info("Recording started")
    }

    func stop() {
        guard isCapturing else { return }
        captureSession?.stopRunning()
        isCapturing = false
        ConductorLog.component("audio-capture").info("Recording stopped")
    }
}

// MARK: - AVCaptureAudioDataOutputSampleBufferDelegate

extension AudioCapture: AVCaptureAudioDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        onAudioBuffer?(sampleBuffer)
    }
}

// MARK: - Errors

enum AudioCaptureError: Error, LocalizedError {
    case noMicrophoneAvailable
    case cannotAddInput
    case cannotAddOutput

    var errorDescription: String? {
        switch self {
        case .noMicrophoneAvailable:
            return "No microphone device available"
        case .cannotAddInput:
            return "Cannot add microphone input to capture session"
        case .cannotAddOutput:
            return "Cannot add audio output to capture session"
        }
    }
}
