// InputProvider.swift — ~platform-abstracted
// Base protocol for all input providers. Platform implementations conform to this.

import Foundation

/// Base protocol for input providers (voice, gesture, gaze).
/// All providers follow a start/stop lifecycle and report readiness.
@MainActor
protocol InputProvider: AnyObject {
    /// Whether this provider is currently active and producing data.
    var isActive: Bool { get }

    /// Start the input pipeline (request permissions, open devices, begin processing).
    func start() async throws

    /// Stop the input pipeline and release resources.
    func stop()
}
