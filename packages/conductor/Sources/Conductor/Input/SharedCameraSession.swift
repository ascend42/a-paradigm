// SharedCameraSession.swift — #shared-camera
// Single AVCaptureSession shared by all Vision-based input providers.
// Distributes camera frames to registered consumers (gaze + gesture).
// Eliminates camera conflicts — one session, multiple Vision requests.

import AVFoundation

/// Protocol for components that process camera frames from the shared session.
@MainActor
protocol CameraFrameConsumer: AnyObject {
    func processCameraFrame(_ pixelBuffer: CVPixelBuffer)
}

/// Shared camera session that distributes frames to multiple consumers.
/// Both VisionGazeProvider and VisionGestureProvider register as consumers,
/// running their own Vision requests on the same frames from one camera.
@MainActor
final class SharedCameraSession: ObservableObject {

    // MARK: - Published State

    @Published private(set) var isRunning = false

    // MARK: - Private

    private var session: AVCaptureSession?
    private let videoOutput = AVCaptureVideoDataOutput()
    private let processingQueue = DispatchQueue(label: "com.a-company.conductor.shared-camera")
    private var delegate: SharedCameraDelegate?
    private var consumers: [WeakConsumer] = []

    // MARK: - Consumer Management

    /// Register a consumer to receive camera frames.
    func addConsumer(_ consumer: CameraFrameConsumer) {
        // Remove dead refs and duplicates
        consumers.removeAll { $0.ref == nil || $0.id == ObjectIdentifier(consumer) }
        consumers.append(WeakConsumer(consumer))
        ConductorLog.component("shared-camera")
            .info("Consumer added (\(self.consumers.count) total)")
    }

    /// Unregister a consumer.
    func removeConsumer(_ consumer: CameraFrameConsumer) {
        consumers.removeAll { $0.ref == nil || $0.id == ObjectIdentifier(consumer) }
        ConductorLog.component("shared-camera")
            .info("Consumer removed (\(self.consumers.count) total)")
    }

    /// Number of active (non-nil) consumers.
    var consumerCount: Int {
        consumers.filter { $0.ref != nil }.count
    }

    // MARK: - Lifecycle

    /// Start the camera session. Safe to call multiple times.
    func start() async throws {
        guard session == nil else { return }

        let newSession = AVCaptureSession()
        newSession.sessionPreset = .medium

        guard let camera = AVCaptureDevice.default(
            .builtInWideAngleCamera, for: .video, position: .front
        ) else {
            throw CameraError.noCameraAvailable
        }

        let input = try AVCaptureDeviceInput(device: camera)
        guard newSession.canAddInput(input) else {
            throw CameraError.cannotConfigure
        }
        newSession.addInput(input)

        videoOutput.alwaysDiscardsLateVideoFrames = true
        let del = SharedCameraDelegate(session: self)
        videoOutput.setSampleBufferDelegate(del, queue: processingQueue)
        self.delegate = del

        guard newSession.canAddOutput(videoOutput) else {
            throw CameraError.cannotConfigure
        }
        newSession.addOutput(videoOutput)

        self.session = newSession
        newSession.startRunning()
        isRunning = true

        ConductorLog.component("shared-camera").info("Camera session started")
    }

    /// Stop the camera session and release resources.
    func stop() {
        session?.stopRunning()
        session = nil
        delegate = nil
        isRunning = false
        ConductorLog.component("shared-camera").info("Camera session stopped")
    }

    // MARK: - Frame Distribution

    /// Called by the delegate on MainActor — distributes frames to all consumers.
    fileprivate func distributeFrame(_ pixelBuffer: CVPixelBuffer) {
        // Clean up dead references
        consumers.removeAll { $0.ref == nil }

        for consumer in consumers {
            consumer.ref?.processCameraFrame(pixelBuffer)
        }
    }
}

// MARK: - Weak Consumer Wrapper

private struct WeakConsumer {
    let id: ObjectIdentifier
    weak var ref: CameraFrameConsumer?

    init(_ consumer: CameraFrameConsumer) {
        self.id = ObjectIdentifier(consumer)
        self.ref = consumer
    }
}

// MARK: - Camera Delegate

/// Bridges AVCaptureVideoDataOutputSampleBufferDelegate to SharedCameraSession.
private final class SharedCameraDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private weak var session: SharedCameraSession?

    init(session: SharedCameraSession) {
        self.session = session
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let session = self.session
        Task { @MainActor in
            session?.distributeFrame(pixelBuffer)
        }
    }
}

// MARK: - Errors

enum CameraError: Error, LocalizedError {
    case noCameraAvailable
    case cannotConfigure

    var errorDescription: String? {
        switch self {
        case .noCameraAvailable:
            return "No front-facing camera available"
        case .cannotConfigure:
            return "Cannot configure camera session"
        }
    }
}
