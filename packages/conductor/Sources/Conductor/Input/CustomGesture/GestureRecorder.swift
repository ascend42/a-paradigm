// GestureRecorder.swift — #gesture-recorder
// Records hand pose time-series from VisionGestureProvider.
// Captures N samples, normalizes duration, produces GestureTemplate.

import Foundation

/// Records custom gesture samples and produces averaged GestureTemplate.
@MainActor
final class GestureRecorder: ObservableObject {

    // MARK: - State

    enum RecorderState: Equatable {
        case idle
        case recording(sample: Int)
        case processing
        case complete
    }

    @Published private(set) var state: RecorderState = .idle
    @Published private(set) var recordedSamples: Int = 0

    // MARK: - Configuration

    /// Number of recordings needed per gesture.
    var requiredSamples: Int = 5

    /// Maximum recording duration per sample (seconds).
    var maxDuration: TimeInterval = 3.0

    // MARK: - Private

    private var samples: [[HandPoseFrame]] = []
    private var currentSample: [HandPoseFrame] = []
    private var recordingStartTime: Date?
    private var recordingTask: Task<Void, Never>?

    // MARK: - Recording

    /// Start recording a new gesture sample.
    func startRecording() {
        currentSample = []
        recordingStartTime = .now
        recordedSamples = samples.count
        state = .recording(sample: samples.count + 1)
    }

    /// Add a hand pose frame to the current recording.
    func addFrame(_ frame: HandPoseFrame) {
        guard case .recording = state else { return }
        currentSample.append(frame)

        // Auto-stop after max duration
        if let start = recordingStartTime,
           Date().timeIntervalSince(start) >= maxDuration {
            stopRecording()
        }
    }

    /// Stop the current recording and save the sample.
    func stopRecording() {
        guard case .recording = state, !currentSample.isEmpty else {
            state = .idle
            return
        }

        // Normalize timestamps relative to start
        let normalizedSample = normalizeTimestamps(currentSample)
        samples.append(normalizedSample)
        recordedSamples = samples.count

        if samples.count >= requiredSamples {
            state = .processing
        } else {
            state = .idle
        }
    }

    /// Build a GestureTemplate from recorded samples.
    func buildTemplate(name: String, action: String, threshold: Double = 0.15) -> GestureTemplate? {
        guard samples.count >= requiredSamples else { return nil }

        // Average all samples to create the template
        let averaged = averageSamples(samples)

        let template = GestureTemplate(
            id: "gesture-\(UUID().uuidString.prefix(8))",
            name: name,
            frames: averaged,
            matchThreshold: threshold,
            createdAt: .now,
            recordingCount: samples.count,
            boundAction: action
        )

        return template
    }

    /// Reset the recorder.
    func reset() {
        state = .idle
        samples = []
        currentSample = []
        recordedSamples = 0
        recordingStartTime = nil
    }

    // MARK: - Processing

    /// Normalize frame timestamps to [0, 1] range.
    private func normalizeTimestamps(_ frames: [HandPoseFrame]) -> [HandPoseFrame] {
        guard let first = frames.first, let last = frames.last else { return frames }
        let duration = last.timestamp - first.timestamp
        guard duration > 0 else { return frames }

        return frames.map { frame in
            HandPoseFrame(
                timestamp: (frame.timestamp - first.timestamp) / duration,
                thumbTip: frame.thumbTip,
                indexTip: frame.indexTip,
                middleTip: frame.middleTip,
                ringTip: frame.ringTip,
                littleTip: frame.littleTip,
                wrist: frame.wrist,
                indexMCP: frame.indexMCP,
                middleMCP: frame.middleMCP,
                ringMCP: frame.ringMCP,
                littleMCP: frame.littleMCP
            )
        }
    }

    /// Average multiple samples into a single representative sequence.
    /// Uses the median sample length and interpolates other samples to match.
    private func averageSamples(_ allSamples: [[HandPoseFrame]]) -> [HandPoseFrame] {
        // Use the median-length sample as the reference
        let sorted = allSamples.sorted { $0.count < $1.count }
        let medianIndex = sorted.count / 2
        let referenceLength = sorted[medianIndex].count

        guard referenceLength > 0 else { return [] }

        // Resample all sequences to the reference length
        let resampled = allSamples.map { resample($0, to: referenceLength) }

        // Average each frame across all samples
        var averaged: [HandPoseFrame] = []
        for i in 0..<referenceLength {
            let frames = resampled.map { $0[i] }
            averaged.append(averageFrames(frames, timestamp: Double(i) / Double(referenceLength)))
        }

        return averaged
    }

    /// Resample a sequence to a target length using linear interpolation.
    private func resample(_ frames: [HandPoseFrame], to targetLength: Int) -> [HandPoseFrame] {
        guard frames.count >= 2 else { return frames }

        var result: [HandPoseFrame] = []
        for i in 0..<targetLength {
            let t = Double(i) / Double(targetLength - 1)
            let srcIndex = t * Double(frames.count - 1)
            let lo = Int(srcIndex)
            let hi = min(lo + 1, frames.count - 1)
            let frac = srcIndex - Double(lo)

            result.append(interpolateFrames(frames[lo], frames[hi], t: frac))
        }
        return result
    }

    /// Linearly interpolate between two frames.
    private func interpolateFrames(_ a: HandPoseFrame, _ b: HandPoseFrame, t: Double) -> HandPoseFrame {
        func lerp(_ pa: CGPointCodable, _ pb: CGPointCodable) -> CGPointCodable {
            CGPointCodable(x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t)
        }

        return HandPoseFrame(
            timestamp: a.timestamp + (b.timestamp - a.timestamp) * t,
            thumbTip: lerp(a.thumbTip, b.thumbTip),
            indexTip: lerp(a.indexTip, b.indexTip),
            middleTip: lerp(a.middleTip, b.middleTip),
            ringTip: lerp(a.ringTip, b.ringTip),
            littleTip: lerp(a.littleTip, b.littleTip),
            wrist: lerp(a.wrist, b.wrist),
            indexMCP: lerp(a.indexMCP, b.indexMCP),
            middleMCP: lerp(a.middleMCP, b.middleMCP),
            ringMCP: lerp(a.ringMCP, b.ringMCP),
            littleMCP: lerp(a.littleMCP, b.littleMCP)
        )
    }

    /// Average multiple frames into one.
    private func averageFrames(_ frames: [HandPoseFrame], timestamp: Double) -> HandPoseFrame {
        let n = Double(frames.count)
        func avg(_ kp: KeyPath<HandPoseFrame, CGPointCodable>) -> CGPointCodable {
            let sumX = frames.reduce(0.0) { $0 + $1[keyPath: kp].x }
            let sumY = frames.reduce(0.0) { $0 + $1[keyPath: kp].y }
            return CGPointCodable(x: sumX / n, y: sumY / n)
        }

        return HandPoseFrame(
            timestamp: timestamp,
            thumbTip: avg(\.thumbTip),
            indexTip: avg(\.indexTip),
            middleTip: avg(\.middleTip),
            ringTip: avg(\.ringTip),
            littleTip: avg(\.littleTip),
            wrist: avg(\.wrist),
            indexMCP: avg(\.indexMCP),
            middleMCP: avg(\.middleMCP),
            ringMCP: avg(\.ringMCP),
            littleMCP: avg(\.littleMCP)
        )
    }
}
