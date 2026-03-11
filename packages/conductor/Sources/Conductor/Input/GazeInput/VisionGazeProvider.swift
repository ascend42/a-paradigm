// VisionGazeProvider.swift — #vision-gaze-provider
// Native Vision framework gaze estimation using face landmarks.
// Replaces MediaPipeGazeProvider — no Python dependency, shares camera
// with VisionGestureProvider via SharedCameraSession.

import Vision
import AVFoundation
import AppKit

/// Native macOS gaze tracking using Apple Vision framework face landmarks.
/// Extracts pupil positions for gaze estimation and eyebrow distances for raise detection.
/// Consumes frames from SharedCameraSession alongside the gesture provider.
@MainActor
final class VisionGazeProvider: ObservableObject, GazeTrackingProvider, CameraFrameConsumer {

    // MARK: - Published State

    @Published private(set) var isActive: Bool = false
    @Published private(set) var isCalibrated: Bool = false

    // MARK: - Configuration

    /// Processing FPS — higher than gesture (15) for smoother gaze tracking.
    var detectionFPS: Int = 30

    // MARK: - Private

    private var faceLandmarksRequest = VNDetectFaceLandmarksRequest()
    private var gazePointContinuation: AsyncStream<CGPoint>.Continuation?
    private var eyebrowContinuation: AsyncStream<EyebrowFrame>.Continuation?
    private let calibrationData = GazeCalibration()
    private var kalmanFilter = KalmanFilter2D()
    private var lastProcessTime: Date = .distantPast
    private var frameInterval: TimeInterval { 1.0 / Double(detectionFPS) }
    private weak var sharedCamera: SharedCameraSession?

    // MARK: - GazeTrackingProvider

    var gazePointStream: AsyncStream<CGPoint> {
        AsyncStream { [weak self] continuation in
            Task { @MainActor in
                self?.gazePointContinuation = continuation
            }
        }
    }

    /// Async stream of raw eyebrow distance frames from face landmarks.
    var eyebrowStream: AsyncStream<EyebrowFrame> {
        AsyncStream { [weak self] continuation in
            Task { @MainActor in
                self?.eyebrowContinuation = continuation
            }
        }
    }

    func calibrate() async throws {
        guard isActive else { throw GazeError.notActive }

        ConductorLog.component("vision-gaze-provider").info("Starting 5-point calibration")

        guard let points = await CalibrationWindowController.run(gazeStream: gazePointStream) else {
            ConductorLog.component("vision-gaze-provider").info("Calibration cancelled")
            return
        }

        calibrationData.reset()
        for point in points {
            calibrationData.addCalibrationPoint(iris: point.iris, screen: point.screen)
        }

        isCalibrated = true
        ConductorLog.gate("gaze-calibrated")
            .info("Calibration complete with \(points.count) points")
    }

    // MARK: - InputProvider

    /// Start gaze tracking by registering with the shared camera session.
    func start() async throws {
        guard let camera = sharedCamera else {
            throw GazeError.noCameraSession
        }

        camera.addConsumer(self)

        if !camera.isRunning {
            try await camera.start()
        }

        isActive = true
        ConductorLog.component("vision-gaze-provider")
            .info("Gaze tracking started (native Vision, \(self.detectionFPS)fps)")
    }

    func stop() {
        sharedCamera?.removeConsumer(self)
        isActive = false
        ConductorLog.component("vision-gaze-provider").info("Gaze tracking stopped")
    }

    /// Set the shared camera session. Must be called before start().
    func setSharedCamera(_ camera: SharedCameraSession) {
        self.sharedCamera = camera
    }

    // MARK: - CameraFrameConsumer

    func processCameraFrame(_ pixelBuffer: CVPixelBuffer) {
        // FPS throttling
        let now = Date()
        guard now.timeIntervalSince(lastProcessTime) >= frameInterval else { return }
        lastProcessTime = now

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        do {
            try handler.perform([faceLandmarksRequest])
            guard let face = faceLandmarksRequest.results?.first else { return }
            processFaceLandmarks(face)
        } catch {
            // Skip frames that fail
        }
    }

    // MARK: - Face Landmark Processing

    private func processFaceLandmarks(_ face: VNFaceObservation) {
        guard let landmarks = face.landmarks else { return }
        let boundingBox = face.boundingBox

        // Extract gaze from pupil positions
        if let gazePoint = extractGazePoint(landmarks: landmarks, boundingBox: boundingBox) {
            processGazePoint(gazePoint)
        }

        // Extract eyebrow raise distances
        if let eyebrowFrame = extractEyebrowFrame(landmarks: landmarks, boundingBox: boundingBox) {
            eyebrowContinuation?.yield(eyebrowFrame)
        }
    }

    /// Extract normalized gaze point from pupil/eye positions.
    private func extractGazePoint(
        landmarks: VNFaceLandmarks2D, boundingBox: CGRect
    ) -> CGPoint? {
        let leftPupilPoint: CGPoint?
        let rightPupilPoint: CGPoint?

        // Left eye — prefer pupil landmark, fall back to eye center
        if let leftPupil = landmarks.leftPupil, leftPupil.pointCount > 0 {
            leftPupilPoint = mapToImage(
                point: leftPupil.normalizedPoints[0], boundingBox: boundingBox
            )
        } else if let leftEye = landmarks.leftEye, leftEye.pointCount > 0 {
            leftPupilPoint = mapToImage(
                point: regionCenter(leftEye), boundingBox: boundingBox
            )
        } else {
            leftPupilPoint = nil
        }

        // Right eye — prefer pupil landmark, fall back to eye center
        if let rightPupil = landmarks.rightPupil, rightPupil.pointCount > 0 {
            rightPupilPoint = mapToImage(
                point: rightPupil.normalizedPoints[0], boundingBox: boundingBox
            )
        } else if let rightEye = landmarks.rightEye, rightEye.pointCount > 0 {
            rightPupilPoint = mapToImage(
                point: regionCenter(rightEye), boundingBox: boundingBox
            )
        } else {
            rightPupilPoint = nil
        }

        // Average both eyes for gaze estimate
        guard let left = leftPupilPoint, let right = rightPupilPoint else {
            return leftPupilPoint ?? rightPupilPoint
        }
        return CGPoint(
            x: (left.x + right.x) / 2.0,
            y: (left.y + right.y) / 2.0
        )
    }

    /// Extract eyebrow raise distances from face landmarks.
    private func extractEyebrowFrame(
        landmarks: VNFaceLandmarks2D, boundingBox: CGRect
    ) -> EyebrowFrame? {
        guard let leftEyebrow = landmarks.leftEyebrow, leftEyebrow.pointCount > 0,
              let rightEyebrow = landmarks.rightEyebrow, rightEyebrow.pointCount > 0,
              let leftEye = landmarks.leftEye, leftEye.pointCount > 0,
              let rightEye = landmarks.rightEye, rightEye.pointCount > 0 else {
            return nil
        }

        // Left: distance from top of eyebrow to top of eye (in face-local coords)
        let leftBrowTop = regionTopY(leftEyebrow)
        let leftEyeTop = regionTopY(leftEye)
        let leftDistance = max(0, leftBrowTop - leftEyeTop)

        // Right: same calculation
        let rightBrowTop = regionTopY(rightEyebrow)
        let rightEyeTop = regionTopY(rightEye)
        let rightDistance = max(0, rightBrowTop - rightEyeTop)

        return EyebrowFrame(leftDistance: leftDistance, rightDistance: rightDistance)
    }

    // MARK: - Coordinate Helpers

    /// Map a point from face-local normalized coords to image-normalized coords.
    private func mapToImage(point: CGPoint, boundingBox: CGRect) -> CGPoint {
        CGPoint(
            x: boundingBox.origin.x + point.x * boundingBox.width,
            y: boundingBox.origin.y + point.y * boundingBox.height
        )
    }

    /// Compute the center of a landmark region.
    private func regionCenter(_ region: VNFaceLandmarkRegion2D) -> CGPoint {
        let points = region.normalizedPoints
        let count = Double(region.pointCount)
        let sumX = (0..<region.pointCount).reduce(0.0) { $0 + points[$1].x }
        let sumY = (0..<region.pointCount).reduce(0.0) { $0 + points[$1].y }
        return CGPoint(x: sumX / count, y: sumY / count)
    }

    /// Find the highest y-value in a landmark region (Vision: y increases upward).
    private func regionTopY(_ region: VNFaceLandmarkRegion2D) -> CGFloat {
        let points = region.normalizedPoints
        var maxY: CGFloat = -1
        for i in 0..<region.pointCount {
            if points[i].y > maxY {
                maxY = points[i].y
            }
        }
        return maxY
    }

    // MARK: - Gaze Processing

    private func processGazePoint(_ rawPoint: CGPoint) {
        let calibratedPoint = calibrationData.mapToScreen(rawPoint)
        let smoothedPoint = kalmanFilter.update(calibratedPoint)
        gazePointContinuation?.yield(smoothedPoint)
    }
}
