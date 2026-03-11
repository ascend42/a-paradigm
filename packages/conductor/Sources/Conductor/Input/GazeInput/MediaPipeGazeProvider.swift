// MediaPipeGazeProvider.swift — #mediapipe-gaze-provider
// MediaPipe FaceMesh gaze estimation via a Python subprocess.
// Iris position → screen coordinate mapping.

import Foundation

/// macOS gaze tracking provider using MediaPipe FaceMesh.
/// Runs a Python subprocess that processes camera frames and returns iris positions.
@MainActor
final class MediaPipeGazeProvider: ObservableObject, GazeTrackingProvider {

    // MARK: - Published State

    @Published private(set) var isActive: Bool = false
    @Published private(set) var isCalibrated: Bool = false

    // MARK: - Private

    private var process: Process?
    private var gazePointContinuation: AsyncStream<CGPoint>.Continuation?
    private var eyebrowContinuation: AsyncStream<EyebrowFrame>.Continuation?
    private let calibrationData = GazeCalibration()
    private var kalmanFilter = KalmanFilter2D()

    /// Path to the bundled Python gaze tracking script.
    private var gazeScriptPath: URL? {
        Bundle.main.url(forResource: "gaze_tracker", withExtension: "py", subdirectory: "Resources/MediaPipe")
    }

    // MARK: - GazeTrackingProvider

    var gazePointStream: AsyncStream<CGPoint> {
        AsyncStream { [weak self] continuation in
            Task { @MainActor in
                self?.gazePointContinuation = continuation
            }
        }
    }

    /// Async stream of raw eyebrow distance frames (when MediaPipe outputs 4 values).
    var eyebrowStream: AsyncStream<EyebrowFrame> {
        AsyncStream { [weak self] continuation in
            Task { @MainActor in
                self?.eyebrowContinuation = continuation
            }
        }
    }

    func calibrate() async throws {
        guard isActive else { throw GazeError.notActive }

        ConductorLog.component("gaze-calibration").info("Starting 5-point calibration")

        // Run the calibration overlay, feeding it the live gaze stream
        guard let points = await CalibrationWindowController.run(gazeStream: gazePointStream) else {
            ConductorLog.component("gaze-calibration").info("Calibration cancelled")
            return
        }

        // Feed collected points into the calibration model
        calibrationData.reset()
        for point in points {
            calibrationData.addCalibrationPoint(iris: point.iris, screen: point.screen)
        }

        isCalibrated = true
        ConductorLog.gate("gaze-calibrated").info("Calibration complete with \(points.count) points")
    }

    // MARK: - InputProvider

    func start() async throws {
        // Check if Python is available
        guard FileManager.default.fileExists(atPath: "/usr/bin/python3") ||
              FileManager.default.fileExists(atPath: "/usr/local/bin/python3") else {
            throw GazeError.pythonNotFound
        }

        // TODO: Check for MediaPipe Python package
        // pip3 show mediapipe

        ConductorLog.component("mediapipe-gaze-provider").info("Starting gaze tracking subprocess")

        // Create and configure the Python subprocess
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        proc.arguments = ["-c", Self.gazeTrackerScript]

        let outputPipe = Pipe()
        proc.standardOutput = outputPipe

        // Read stdout line by line for gaze coordinates
        let outHandle = outputPipe.fileHandleForReading
        outHandle.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty,
                  let line = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !line.isEmpty else { return }

            // Parse "x,y" or "x,y,leftRaise,rightRaise" coordinates
            let parts = line.split(separator: ",")
            if parts.count >= 2,
               let x = Double(parts[0]),
               let y = Double(parts[1]) {
                Task { @MainActor in
                    self?.processGazePoint(CGPoint(x: x, y: y))

                    // Extended format: also includes eyebrow distances
                    if parts.count >= 4,
                       let leftRaise = Double(parts[2]),
                       let rightRaise = Double(parts[3]) {
                        self?.eyebrowContinuation?.yield(
                            EyebrowFrame(leftDistance: leftRaise, rightDistance: rightRaise)
                        )
                    }
                }
            }
        }

        try proc.run()
        self.process = proc
        isActive = true

        ConductorLog.component("mediapipe-gaze-provider").info("Gaze tracking active")
    }

    func stop() {
        process?.terminate()
        process = nil
        isActive = false
        ConductorLog.component("mediapipe-gaze-provider").info("Gaze tracking stopped")
    }

    // MARK: - Processing

    private func processGazePoint(_ rawPoint: CGPoint) {
        // Apply calibration mapping
        let calibratedPoint = calibrationData.mapToScreen(rawPoint)

        // Apply Kalman filter for smoothing
        let smoothedPoint = kalmanFilter.update(calibratedPoint)

        gazePointContinuation?.yield(smoothedPoint)
    }

    // MARK: - Embedded Python Script

    /// Minimal Python script for MediaPipe FaceMesh gaze tracking.
    /// Outputs iris center coordinates as "x,y\n" on stdout.
    private static let gazeTrackerScript = """
    import sys
    try:
        import cv2
        import mediapipe as mp
    except ImportError:
        print("ERROR:mediapipe or opencv-python not installed", file=sys.stderr)
        print("Install with: pip3 install mediapipe opencv-python", file=sys.stderr)
        sys.exit(1)

    mp_face_mesh = mp.solutions.face_mesh
    face_mesh = mp_face_mesh.FaceMesh(
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    )

    # Left iris indices: 468-472, Right iris indices: 473-477
    LEFT_IRIS = [468, 469, 470, 471, 472]
    RIGHT_IRIS = [473, 474, 475, 476, 477]

    # Eyebrow landmark indices
    LEFT_BROW_TOP = [223, 222, 221]   # left eyebrow upper edge
    LEFT_EYE_REF  = [159]              # left eye upper lid (baseline)
    RIGHT_BROW_TOP = [443, 442, 441]  # right eyebrow upper edge
    RIGHT_EYE_REF  = [386]             # right eye upper lid (baseline)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR:cannot open camera", file=sys.stderr)
        sys.exit(1)

    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(rgb)

            if results.multi_face_landmarks:
                landmarks = results.multi_face_landmarks[0].landmark

                # Average iris positions
                left_x = sum(landmarks[i].x for i in LEFT_IRIS) / len(LEFT_IRIS)
                left_y = sum(landmarks[i].y for i in LEFT_IRIS) / len(LEFT_IRIS)
                right_x = sum(landmarks[i].x for i in RIGHT_IRIS) / len(RIGHT_IRIS)
                right_y = sum(landmarks[i].y for i in RIGHT_IRIS) / len(RIGHT_IRIS)

                # Average of both eyes
                gaze_x = (left_x + right_x) / 2
                gaze_y = (left_y + right_y) / 2

                # Eyebrow raise distances (distance from brow to eye — larger = more raised)
                left_brow_y  = sum(landmarks[i].y for i in LEFT_BROW_TOP) / len(LEFT_BROW_TOP)
                left_ref_y   = landmarks[LEFT_EYE_REF[0]].y
                right_brow_y = sum(landmarks[i].y for i in RIGHT_BROW_TOP) / len(RIGHT_BROW_TOP)
                right_ref_y  = landmarks[RIGHT_EYE_REF[0]].y

                left_raise  = max(0, left_ref_y - left_brow_y)
                right_raise = max(0, right_ref_y - right_brow_y)

                print(f"{gaze_x:.6f},{gaze_y:.6f},{left_raise:.6f},{right_raise:.6f}", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
    """
}

// MARK: - Errors

enum GazeError: Error, LocalizedError {
    case pythonNotFound
    case mediapipeNotInstalled
    case notActive
    case calibrationFailed
    case noCameraSession

    var errorDescription: String? {
        switch self {
        case .pythonNotFound:
            return "Python 3 is required for gaze tracking. Install via Xcode Command Line Tools or brew."
        case .mediapipeNotInstalled:
            return "MediaPipe is required. Install with: pip3 install mediapipe opencv-python"
        case .notActive:
            return "Gaze tracking must be started before calibration"
        case .calibrationFailed:
            return "Gaze calibration failed — ensure good lighting and face the camera"
        case .noCameraSession:
            return "No shared camera session available — configure SharedCameraSession before starting"
        }
    }
}
