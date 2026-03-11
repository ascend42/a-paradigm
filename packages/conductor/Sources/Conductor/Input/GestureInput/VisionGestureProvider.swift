// VisionGestureProvider.swift — #vision-gesture-provider
// Apple Vision framework hand pose detection at 15fps.
// Uses VNDetectHumanHandPoseRequest on the Neural Engine.

import Vision
import AVFoundation

/// macOS gesture input provider using Apple Vision framework.
@MainActor
final class VisionGestureProvider: ObservableObject, GestureInputProvider {

    // MARK: - Published State

    @Published private(set) var isActive: Bool = false
    @Published private(set) var currentHandState: HandState = .none

    // MARK: - Configuration

    var detectionFPS: Int = 15

    // MARK: - Private

    private var captureSession: AVCaptureSession?
    private let videoOutput = AVCaptureVideoDataOutput()
    private let processingQueue = DispatchQueue(label: "com.a-company.conductor.gesture-processing")
    private var handPoseRequest = VNDetectHumanHandPoseRequest()
    private var gestureContinuation: AsyncStream<GestureAction>.Continuation?
    private var handPoseContinuation: AsyncStream<HandPoseFrame>.Continuation?
    private var classifier: GestureClassifier
    private var stateMachine: GestureStateMachine
    private var lastProcessTime: Date = .distantPast
    private var startTime: Date = .now
    private var frameInterval: TimeInterval { 1.0 / Double(detectionFPS) }

    init() {
        self.classifier = GestureClassifier()
        self.stateMachine = GestureStateMachine()
        handPoseRequest.maximumHandCount = 1
    }

    // MARK: - GestureInputProvider

    var gestureStream: AsyncStream<GestureAction> {
        AsyncStream { [weak self] continuation in
            Task { @MainActor in
                self?.gestureContinuation = continuation
            }
        }
    }

    /// Raw hand pose frame stream for custom gesture recording and matching.
    var handPoseStream: AsyncStream<HandPoseFrame> {
        AsyncStream { [weak self] continuation in
            Task { @MainActor in
                self?.handPoseContinuation = continuation
            }
        }
    }

    // MARK: - InputProvider

    func start() async throws {
        let session = AVCaptureSession()
        session.sessionPreset = .medium

        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
            throw GestureProviderError.noCameraAvailable
        }

        let input = try AVCaptureDeviceInput(device: camera)
        guard session.canAddInput(input) else {
            throw GestureProviderError.cannotConfigureCamera
        }
        session.addInput(input)

        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(
            GestureVideoDelegate(provider: self),
            queue: processingQueue
        )
        guard session.canAddOutput(videoOutput) else {
            throw GestureProviderError.cannotConfigureCamera
        }
        session.addOutput(videoOutput)

        self.captureSession = session
        session.startRunning()
        isActive = true

        let fps = detectionFPS
        ConductorLog.component("vision-gesture-provider").info("Gesture detection started at \(fps)fps")
    }

    func stop() {
        captureSession?.stopRunning()
        captureSession = nil
        isActive = false
        currentHandState = .none
        ConductorLog.component("vision-gesture-provider").info("Gesture detection stopped")
    }

    // MARK: - Frame Processing

    fileprivate func processFrame(_ pixelBuffer: CVPixelBuffer) {
        // Throttle to configured FPS
        let now = Date()
        guard now.timeIntervalSince(lastProcessTime) >= frameInterval else { return }
        lastProcessTime = now

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        do {
            try handler.perform([handPoseRequest])
            guard let observation = handPoseRequest.results?.first else {
                Task { @MainActor in
                    currentHandState = .none
                }
                return
            }
            processHandPose(observation)
        } catch {
            // Silently skip frames that fail
        }
    }

    private func processHandPose(_ observation: VNHumanHandPoseObservation) {
        let handState = classifier.classify(observation)
        let action = stateMachine.process(handState)

        // Extract hand pose frame for custom gesture recording/matching
        let poseFrame = extractHandPoseFrame(from: observation)

        Task { @MainActor in
            currentHandState = handState
            if action != .none {
                gestureContinuation?.yield(action)
                ConductorLog.signal("gesture-recognized")
                    .info("Gesture: \(String(describing: action))")
            }
            if let frame = poseFrame {
                handPoseContinuation?.yield(frame)
            }
        }
    }

    /// Extract a HandPoseFrame from a Vision observation for custom gesture support.
    private func extractHandPoseFrame(from observation: VNHumanHandPoseObservation) -> HandPoseFrame? {
        guard let thumbTip = try? observation.recognizedPoint(.thumbTip),
              let indexTip = try? observation.recognizedPoint(.indexTip),
              let middleTip = try? observation.recognizedPoint(.middleTip),
              let ringTip = try? observation.recognizedPoint(.ringTip),
              let littleTip = try? observation.recognizedPoint(.littleTip),
              let wrist = try? observation.recognizedPoint(.wrist),
              let indexMCP = try? observation.recognizedPoint(.indexMCP),
              let middleMCP = try? observation.recognizedPoint(.middleMCP),
              let ringMCP = try? observation.recognizedPoint(.ringMCP),
              let littleMCP = try? observation.recognizedPoint(.littleMCP) else {
            return nil
        }

        return HandPoseFrame(
            timestamp: Date().timeIntervalSince(startTime),
            thumbTip: CGPointCodable(thumbTip.location),
            indexTip: CGPointCodable(indexTip.location),
            middleTip: CGPointCodable(middleTip.location),
            ringTip: CGPointCodable(ringTip.location),
            littleTip: CGPointCodable(littleTip.location),
            wrist: CGPointCodable(wrist.location),
            indexMCP: CGPointCodable(indexMCP.location),
            middleMCP: CGPointCodable(middleMCP.location),
            ringMCP: CGPointCodable(ringMCP.location),
            littleMCP: CGPointCodable(littleMCP.location)
        )
    }
}

// MARK: - Video Delegate

/// Bridges AVCaptureVideoDataOutputSampleBufferDelegate to the provider.
private final class GestureVideoDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private weak var provider: VisionGestureProvider?

    init(provider: VisionGestureProvider) {
        self.provider = provider
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let provider = self.provider
        Task { @MainActor in
            provider?.processFrame(pixelBuffer)
        }
    }
}

// MARK: - Errors

enum GestureProviderError: Error, LocalizedError {
    case noCameraAvailable
    case cannotConfigureCamera

    var errorDescription: String? {
        switch self {
        case .noCameraAvailable:
            return "No front-facing camera available for gesture detection"
        case .cannotConfigureCamera:
            return "Cannot configure camera for gesture detection"
        }
    }
}
