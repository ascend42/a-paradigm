// GazeRouter.swift — #gaze-router
// Maps gaze screen points to Claude Code window targets.
// Full implementation ships in Sprint 4.

import Foundation

/// Routes gaze points to the appropriate Claude Code instance.
/// Uses dwell selection: the gaze must rest on a window for a configurable
/// duration before it becomes the target.
@MainActor
final class GazeRouter: ObservableObject {
    /// The currently targeted instance (nil if no target).
    @Published private(set) var currentTarget: ClaudeCodeInstance?

    /// Dwell duration required to switch targets (seconds).
    var dwellDuration: TimeInterval = 0.5

    /// Manually set the target (used when gaze is unavailable).
    func setTarget(_ instance: ClaudeCodeInstance?) {
        guard instance?.id != currentTarget?.id else { return }
        currentTarget = instance
        if let target = instance {
            ConductorLog.signal("gaze-target-changed")
                .info("Target changed to: \(target.title)")
        }
    }
}
