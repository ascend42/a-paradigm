// GazeCalibration.swift — #gaze-calibration
// 5-point calibration data and iris-to-screen coordinate mapping.
// Uses least-squares affine fitting over all collected points.

import AppKit

/// Stores calibration data for mapping iris positions to screen coordinates.
/// Uses a 5-point calibration: center, top-left, top-right, bottom-left, bottom-right.
final class GazeCalibration {
    /// Calibration point pairs: (iris position, screen position).
    private var calibrationPoints: [(iris: CGPoint, screen: CGPoint)] = []

    /// Cached affine coefficients after calibration.
    /// [a11, a12, tx] for x; [a21, a22, ty] for y.
    private var coeffX: [Double]?
    private var coeffY: [Double]?

    /// Whether calibration data is available.
    var hasCalibration: Bool { coeffX != nil && coeffY != nil }

    // MARK: - Calibration

    /// Record a calibration sample.
    func addCalibrationPoint(iris: CGPoint, screen: CGPoint) {
        calibrationPoints.append((iris: iris, screen: screen))
        // Recompute affine whenever we have enough points
        if calibrationPoints.count >= 3 {
            computeAffineCoefficients()
        }
    }

    /// Reset calibration data.
    func reset() {
        calibrationPoints.removeAll()
        coeffX = nil
        coeffY = nil
    }

    /// The 5 calibration target points on screen (AppKit coordinates, Y-up).
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
        guard let cx = coeffX, let cy = coeffY else {
            return simpleMap(irisPoint)
        }

        let ix = Double(irisPoint.x)
        let iy = Double(irisPoint.y)

        return CGPoint(
            x: cx[0] * ix + cx[1] * iy + cx[2],
            y: cy[0] * ix + cy[1] * iy + cy[2]
        )
    }

    // MARK: - Diagnostics

    /// Average calibration residual in pixels (lower is better).
    /// Returns nil if not calibrated.
    func calibrationQuality() -> Double? {
        guard hasCalibration else { return nil }

        var totalError: Double = 0
        for p in calibrationPoints {
            let mapped = mapToScreen(p.iris)
            let dx = Double(mapped.x - p.screen.x)
            let dy = Double(mapped.y - p.screen.y)
            totalError += sqrt(dx * dx + dy * dy)
        }
        return totalError / Double(calibrationPoints.count)
    }

    /// Per-point residuals in pixels.
    func residuals() -> [(target: CGPoint, mapped: CGPoint, error: CGFloat)] {
        guard hasCalibration else { return [] }
        return calibrationPoints.map { p in
            let mapped = mapToScreen(p.iris)
            let dx = mapped.x - p.screen.x
            let dy = mapped.y - p.screen.y
            return (target: p.screen, mapped: mapped, error: sqrt(dx * dx + dy * dy))
        }
    }

    // MARK: - Simple Mapping (no calibration)

    private func simpleMap(_ iris: CGPoint) -> CGPoint {
        let bounds = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1920, height: 1080)
        // Iris coordinates are normalized 0–1 (Vision framework, Y-up).
        // X is mirrored (front-facing webcam).
        // Y must be flipped: Vision Y-up → AppKit Y-up is fine, but iris Y
        // represents "position in image" where top-of-image = high Y in Vision.
        // Looking down → iris moves down in image → lower Y. Map directly.
        return CGPoint(
            x: bounds.origin.x + (1.0 - iris.x) * bounds.width,
            y: bounds.origin.y + iris.y * bounds.height
        )
    }

    // MARK: - Least-Squares Affine

    /// Compute affine coefficients using least-squares over all calibration points.
    /// Solves: screen = A * iris + b (separately for x and y components).
    /// With n points, this minimizes the sum of squared residuals.
    private func computeAffineCoefficients() {
        let n = calibrationPoints.count
        guard n >= 3 else {
            coeffX = nil
            coeffY = nil
            return
        }

        // Build normal equations: (M^T M) * c = M^T b
        // where M[i] = [iris_x, iris_y, 1], b[i] = screen_x or screen_y
        var mtm = [[Double]](repeating: [Double](repeating: 0, count: 3), count: 3)
        var mtbx = [Double](repeating: 0, count: 3)
        var mtby = [Double](repeating: 0, count: 3)

        for p in calibrationPoints {
            let row = [Double(p.iris.x), Double(p.iris.y), 1.0]
            let sx = Double(p.screen.x)
            let sy = Double(p.screen.y)

            for i in 0..<3 {
                for j in 0..<3 {
                    mtm[i][j] += row[i] * row[j]
                }
                mtbx[i] += row[i] * sx
                mtby[i] += row[i] * sy
            }
        }

        coeffX = solve3x3(mtm, mtbx)
        coeffY = solve3x3(mtm, mtby)
    }

    /// Solve a 3x3 linear system via Gaussian elimination with partial pivoting.
    private func solve3x3(_ a: [[Double]], _ b: [Double]) -> [Double]? {
        // Augmented matrix [A | b]
        var m = a.enumerated().map { (i, row) in row + [b[i]] }

        for col in 0..<3 {
            // Partial pivot
            var maxVal = abs(m[col][col])
            var maxRow = col
            for row in (col + 1)..<3 {
                if abs(m[row][col]) > maxVal {
                    maxVal = abs(m[row][col])
                    maxRow = row
                }
            }

            guard maxVal > 1e-10 else { return nil }

            if maxRow != col {
                m.swapAt(col, maxRow)
            }

            // Forward elimination
            for row in (col + 1)..<3 {
                let factor = m[row][col] / m[col][col]
                for j in col..<4 {
                    m[row][j] -= factor * m[col][j]
                }
            }
        }

        // Back-substitution
        var result = [Double](repeating: 0, count: 3)
        for i in stride(from: 2, through: 0, by: -1) {
            result[i] = m[i][3]
            for j in (i + 1)..<3 {
                result[i] -= m[i][j] * result[j]
            }
            result[i] /= m[i][i]
        }

        return result
    }
}
