// CustomGestureClassifier.swift — #custom-gesture-classifier
// Runs alongside built-in GestureClassifier.
// Buffers recent hand pose frames in a sliding window,
// compares against registered templates via DTW.

import Foundation

/// Classifies incoming hand pose frames against user-recorded gesture templates.
@MainActor
final class CustomGestureClassifier: ObservableObject {

    // MARK: - Published State

    @Published private(set) var lastRecognizedGesture: String?
    @Published private(set) var lastConfidence: Double = 0

    // MARK: - Configuration

    /// How many frames to buffer before attempting a match.
    var windowSize: Int = 30  // ~2 seconds at 15fps

    /// How often to run matching (every N frames).
    var matchInterval: Int = 5

    /// Maximum number of custom gestures.
    static let maxTemplates = 20

    // MARK: - Private

    private var templates: [GestureTemplate] = []
    private var frameBuffer: [HandPoseFrame] = []
    private var frameCount = 0
    private var actionContinuation: AsyncStream<ConductorAction>.Continuation?

    // MARK: - Stream

    /// Stream of recognized custom gesture actions.
    var actionStream: AsyncStream<ConductorAction> {
        AsyncStream { [weak self] continuation in
            Task { @MainActor in
                self?.actionContinuation = continuation
            }
        }
    }

    // MARK: - Template Management

    /// Load templates from disk.
    func loadTemplates() {
        templates = GestureTemplate.loadAll()
        ConductorLog.component("custom-gesture-classifier")
            .info("Loaded \(self.templates.count) custom gesture templates")
    }

    /// Add a template (up to max).
    func addTemplate(_ template: GestureTemplate) -> Bool {
        guard templates.count < Self.maxTemplates else { return false }
        templates.append(template)
        return true
    }

    /// Remove a template by ID.
    func removeTemplate(id: String) {
        templates.removeAll { $0.id == id }
    }

    /// Get all registered templates.
    var registeredTemplates: [GestureTemplate] { templates }

    // MARK: - Frame Processing

    /// Process a new hand pose frame.
    func processFrame(_ frame: HandPoseFrame) {
        frameBuffer.append(frame)

        // Keep buffer at window size
        if frameBuffer.count > windowSize {
            frameBuffer.removeFirst()
        }

        frameCount += 1

        // Only attempt matching every N frames and when buffer is full
        guard frameCount % matchInterval == 0,
              frameBuffer.count >= windowSize / 2,
              !templates.isEmpty else { return }

        matchAgainstTemplates()
    }

    /// Clear the frame buffer.
    func clearBuffer() {
        frameBuffer.removeAll()
        frameCount = 0
    }

    // MARK: - Matching

    private func matchAgainstTemplates() {
        var bestMatch: GestureTemplate?
        var bestDistance = Double.infinity

        for template in templates {
            let distance = DTWMatcher.match(frameBuffer, against: template)
            if distance < bestDistance {
                bestDistance = distance
                bestMatch = template
            }
        }

        guard let match = bestMatch, DTWMatcher.isMatch(frameBuffer, template: match) else {
            return
        }

        // Confidence: 1.0 when distance is 0, 0.0 when at threshold
        let confidence = max(0, 1.0 - bestDistance / match.matchThreshold)

        lastRecognizedGesture = match.name
        lastConfidence = confidence

        // Fire the bound action
        if let action = ActionRegistry.actionFromName(match.boundAction) {
            actionContinuation?.yield(action)
            ConductorLog.signal("custom-gesture-recognized")
                .info("Custom gesture '\(match.name)' recognized (confidence: \(String(format: "%.2f", confidence)))")
        }

        // Clear buffer to prevent repeated matches
        clearBuffer()
    }
}
