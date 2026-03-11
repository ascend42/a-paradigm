// GazeCalibrationView.swift — #gaze-calibration
// Fullscreen 5-point calibration overlay.
// Shows pulsating targets one at a time; collects iris samples via an AsyncStream.

import SwiftUI

/// Result of a completed calibration: paired iris and screen points.
typealias CalibrationCompletion = ([(iris: CGPoint, screen: CGPoint)]) -> Void

/// Fullscreen SwiftUI view that walks the user through 5 calibration targets.
struct GazeCalibrationView: View {
    /// Live iris-position stream from the gaze provider.
    let gazeStream: AsyncStream<CGPoint>

    /// Called with collected point pairs on success, or nil on cancel.
    let onComplete: ([(iris: CGPoint, screen: CGPoint)]?) -> Void

    // MARK: - State

    @State private var currentIndex: Int = 0
    @State private var dwellProgress: CGFloat = 0
    @State private var irisSamples: [CGPoint] = []
    @State private var collectedPairs: [(iris: CGPoint, screen: CGPoint)] = []
    @State private var showComplete: Bool = false
    @State private var pulseScale: CGFloat = 1.0
    @State private var gazeTask: Task<Void, Never>?
    @State private var dwellTask: Task<Void, Never>?
    @State private var currentGazePoint: CGPoint? = nil

    /// Calibration targets computed from screen geometry.
    private var targets: [CGPoint] {
        GazeCalibration().calibrationTargets()
    }

    private let targetCount = 5
    private let dwellSeconds: TimeInterval = 2.0

    // MARK: - Body

    var body: some View {
        ZStack {
            // Semi-transparent backdrop
            Color.black.opacity(0.75)
                .ignoresSafeArea()

            if showComplete {
                completionBanner
            } else {
                calibrationContent
            }

            // ESC hint — bottom center
            VStack {
                Spacer()
                Text("ESC to cancel")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.5))
                    .padding(.bottom, 32)
            }
        }
        .onAppear(perform: startDwell)
        .onDisappear(perform: tearDown)
        .onKeyPress(.escape) {
            cancel()
            return .handled
        }
    }

    // MARK: - Subviews

    private var calibrationContent: some View {
        ZStack {
            // Progress label — top center
            VStack {
                Text("Point \(currentIndex + 1) of \(targetCount)")
                    .font(.title3.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.8))
                    .padding(.top, 48)

                Text("Look at the cyan target")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.4))
                Spacer()
            }

            // Target reticle positioned in screen coordinates
            targetReticle

            // Live gaze position dot — shows where the system thinks you're looking
            gazePositionDot
        }
    }

    private var gazePositionDot: some View {
        GeometryReader { geo in
            if let gaze = currentGazePoint {
                let x = gaze.x * geo.size.width
                let y = gaze.y * geo.size.height

                Circle()
                    .fill(Color.yellow.opacity(0.6))
                    .frame(width: 14, height: 14)
                    .overlay(
                        Circle()
                            .stroke(Color.yellow.opacity(0.3), lineWidth: 2)
                            .frame(width: 22, height: 22)
                    )
                    .position(x: x, y: y)
                    .animation(.linear(duration: 0.05), value: gaze.x)
                    .animation(.linear(duration: 0.05), value: gaze.y)
            }
        }
    }

    private var targetReticle: some View {
        let point = currentIndex < targets.count ? targets[currentIndex] : .zero

        return GeometryReader { geo in
            let localX = point.x
            let localY = geo.size.height - point.y // Flip: AppKit Y-up -> SwiftUI Y-down

            ZStack {
                // Outer pulsating ring
                Circle()
                    .stroke(Color.cyan.opacity(0.4), lineWidth: 2)
                    .frame(width: 60, height: 60)
                    .scaleEffect(pulseScale)
                    .animation(
                        .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                        value: pulseScale
                    )

                // Progress arc — fills clockwise
                Circle()
                    .trim(from: 0, to: dwellProgress)
                    .stroke(Color.cyan, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .frame(width: 48, height: 48)
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 0.05), value: dwellProgress)

                // Center dot
                Circle()
                    .fill(Color.cyan)
                    .frame(width: 10, height: 10)
            }
            .position(x: localX, y: localY)
        }
        .onAppear { pulseScale = 1.12 }
    }

    private var completionBanner: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(.cyan)
            Text("Calibration Complete")
                .font(.title2.bold())
                .foregroundStyle(.white)
        }
        .transition(.opacity)
    }

    // MARK: - Dwell Logic

    private func startDwell() {
        // Begin consuming the gaze stream for iris samples + live feedback
        gazeTask = Task { @MainActor in
            for await irisPoint in gazeStream {
                irisSamples.append(irisPoint)
                currentGazePoint = irisPoint
            }
        }

        // Start the dwell timer for the current target
        beginDwellTimer()
    }

    private func beginDwellTimer() {
        dwellProgress = 0
        irisSamples.removeAll()

        dwellTask = Task { @MainActor in
            let steps = 40 // update ~20 times per second over 2s
            let interval = dwellSeconds / Double(steps)

            for step in 1...steps {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                guard !Task.isCancelled else { return }
                dwellProgress = CGFloat(step) / CGFloat(steps)
            }

            // Dwell complete for this target
            advanceTarget()
        }
    }

    private func advanceTarget() {
        guard currentIndex < targets.count else { return }

        // Average collected iris samples
        let avgIris: CGPoint
        if irisSamples.isEmpty {
            // No gaze data received — use a zero placeholder
            avgIris = .zero
        } else {
            let sumX = irisSamples.reduce(0.0) { $0 + $1.x }
            let sumY = irisSamples.reduce(0.0) { $0 + $1.y }
            let count = CGFloat(irisSamples.count)
            avgIris = CGPoint(x: sumX / count, y: sumY / count)
        }

        let screenPoint = targets[currentIndex]
        collectedPairs.append((iris: avgIris, screen: screenPoint))

        let nextIndex = currentIndex + 1
        if nextIndex >= targetCount {
            finishCalibration()
        } else {
            currentIndex = nextIndex
            beginDwellTimer()
        }
    }

    private func finishCalibration() {
        dwellTask?.cancel()
        gazeTask?.cancel()
        showComplete = true

        ConductorLog.signal("calibration-complete")
            .info("Collected \(collectedPairs.count) calibration points")

        // Brief pause to show completion, then dismiss
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_200_000_000) // 1.2s
            onComplete(collectedPairs)
        }
    }

    private func cancel() {
        tearDown()
        onComplete(nil)
    }

    private func tearDown() {
        dwellTask?.cancel()
        gazeTask?.cancel()
    }
}
