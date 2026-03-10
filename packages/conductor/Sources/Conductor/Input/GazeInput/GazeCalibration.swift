// GazeCalibration.swift — #gaze-calibration
// 5-point calibration data and iris-to-screen coordinate mapping.

import AppKit

/// Stores calibration data for mapping iris positions to screen coordinates.
/// Uses a 5-point calibration: center, top-left, top-right, bottom-left, bottom-right.
final class GazeCalibration {
    /// Calibration point pairs: (iris position, screen position).
    private var calibrationPoints: [(iris: CGPoint, screen: CGPoint)] = []

    /// Screen bounds for coordinate mapping.
    private var screenBounds: CGRect = .zero

    /// Whether calibration data is available.
    var hasCalibration: Bool { !calibrationPoints.isEmpty }

    // MARK: - Calibration

    /// Record a calibration sample.
    func addCalibrationPoint(iris: CGPoint, screen: CGPoint) {
        calibrationPoints.append((iris: iris, screen: screen))
    }

    /// Reset calibration data.
    func reset() {
        calibrationPoints.removeAll()
        if let screen = NSScreen.main {
            screenBounds = screen.frame
        }
    }

    /// The 5 calibration target points on screen.
    func calibrationTargets() -> [CGPoint] {
        let bounds = NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1920, height: 1080)
        let margin: CGFloat = 100

        return [
            CGPoint(x: bounds.midX, y: bounds.midY),                               // Center
            CGPoint(x: bounds.minX + margin, y: bounds.maxY - margin),             // Top-left
            CGPoint(x: bounds.maxX - margin, y: bounds.maxY - margin),             // Top-right
            CGPoint(x: bounds.minX + margin, y: bounds.minY + margin),             // Bottom-left
            CGPoint(x: bounds.maxX - margin, y: bounds.minY + margin),             // Bottom-right
        ]
    }

    // MARK: - Mapping

    /// Map an iris position to screen coordinates using calibration data.
    /// If no calibration, uses a simple linear mapping.
    func mapToScreen(_ irisPoint: CGPoint) -> CGPoint {
        guard hasCalibration, calibrationPoints.count >= 3 else {
            return simpleMap(irisPoint)
        }

        // Use affine transformation from calibration points.
        // With 5+ points we can do least-squares fitting.
        return affineMap(irisPoint)
    }

    // MARK: - Simple Mapping (no calibration)

    private func simpleMap(_ iris: CGPoint) -> CGPoint {
        let bounds = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1920, height: 1080)
        // Iris coordinates are normalized 0-1, map to screen
        // Note: x is mirrored (webcam is mirrored)
        return CGPoint(
            x: bounds.origin.x + (1.0 - iris.x) * bounds.width,
            y: bounds.origin.y + iris.y * bounds.height
        )
    }

    // MARK: - Affine Mapping (calibrated)

    private func affineMap(_ iris: CGPoint) -> CGPoint {
        // Compute affine transform from iris space to screen space
        // using least-squares from calibration points.
        // For 2D affine: screen = A * iris + b
        // We solve for A (2x2) and b (2x1) using collected points.

        guard calibrationPoints.count >= 3 else {
            return simpleMap(iris)
        }

        // Use first 3 points for a basic affine transform
        let p = calibrationPoints
        let srcTri = [p[0].iris, p[1].iris, p[2].iris]
        let dstTri = [p[0].screen, p[1].screen, p[2].screen]

        // Solve 2D affine from 3 point correspondences
        let denom = (srcTri[0].x - srcTri[2].x) * (srcTri[1].y - srcTri[2].y)
                  - (srcTri[1].x - srcTri[2].x) * (srcTri[0].y - srcTri[2].y)

        guard abs(denom) > 1e-10 else { return simpleMap(iris) }

        let a11 = ((dstTri[0].x - dstTri[2].x) * (srcTri[1].y - srcTri[2].y)
                 - (dstTri[1].x - dstTri[2].x) * (srcTri[0].y - srcTri[2].y)) / denom
        let a12 = ((dstTri[1].x - dstTri[2].x) * (srcTri[0].x - srcTri[2].x)
                 - (dstTri[0].x - dstTri[2].x) * (srcTri[1].x - srcTri[2].x)) / denom
        let a21 = ((dstTri[0].y - dstTri[2].y) * (srcTri[1].y - srcTri[2].y)
                 - (dstTri[1].y - dstTri[2].y) * (srcTri[0].y - srcTri[2].y)) / denom
        let a22 = ((dstTri[1].y - dstTri[2].y) * (srcTri[0].x - srcTri[2].x)
                 - (dstTri[0].y - dstTri[2].y) * (srcTri[1].x - srcTri[2].x)) / denom

        let tx = dstTri[2].x - a11 * srcTri[2].x - a12 * srcTri[2].y
        let ty = dstTri[2].y - a21 * srcTri[2].x - a22 * srcTri[2].y

        return CGPoint(
            x: a11 * iris.x + a12 * iris.y + tx,
            y: a21 * iris.x + a22 * iris.y + ty
        )
    }
}
