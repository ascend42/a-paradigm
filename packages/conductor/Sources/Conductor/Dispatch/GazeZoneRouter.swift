// GazeZoneRouter.swift — #gaze-zone-router
// Maps gaze screen points to workspace grid cells deterministically.
// Replaces GazeRouter's arbitrary window matching with grid zone detection.

import Foundation

/// Routes gaze points to workspace grid cells using deterministic zone boundaries.
/// Uses dwell timer to lock on a target cell, preventing rapid switching.
@MainActor
final class GazeZoneRouter: ObservableObject {

    // MARK: - Published State

    /// Currently targeted grid cell index (nil if no target or gaze in sidebar).
    @Published private(set) var targetedCellIndex: Int?

    /// The managed instance at the targeted cell (nil if no target).
    @Published private(set) var targetedInstance: ManagedInstance?

    /// Current raw gaze screen point (for debug overlay).
    @Published private(set) var currentGazePoint: CGPoint?

    /// Whether the dwell timer has locked on the current cell.
    @Published private(set) var isDwelling: Bool = false

    // MARK: - Configuration

    /// How long gaze must rest on a cell before it becomes the target.
    var dwellDuration: TimeInterval = 0.5

    // MARK: - Private

    private var pendingCellIndex: Int?
    private var dwellStartTime: Date?
    private weak var workspaceManager: WorkspaceManager?

    // MARK: - Init

    init(workspaceManager: WorkspaceManager? = nil) {
        self.workspaceManager = workspaceManager
    }

    /// Wire to a workspace manager for instance resolution.
    func setWorkspaceManager(_ manager: WorkspaceManager) {
        self.workspaceManager = manager
    }

    // MARK: - Gaze Processing

    /// Update the current gaze screen point and resolve to a grid cell.
    func updateGazePoint(_ point: CGPoint) {
        currentGazePoint = point

        guard let manager = workspaceManager else { return }
        let grid = manager.currentGrid()

        let cellIndex = grid.cellIndex(for: point)

        if cellIndex == pendingCellIndex {
            // Same cell — check dwell timer
            if let start = dwellStartTime {
                let elapsed = Date().timeIntervalSince(start)
                if elapsed >= dwellDuration && !isDwelling {
                    // Dwell threshold reached — lock on
                    isDwelling = true
                    targetedCellIndex = cellIndex

                    if let index = cellIndex, index < manager.managedInstances.count {
                        targetedInstance = manager.managedInstances[index]
                        // Also update the shared GazeRouter for backward compatibility
                        GazeRouter.shared.setTarget(manager.managedInstances[index].instance)
                        ConductorLog.signal("gaze-target-changed")
                            .info("Gaze locked on cell \(index)")
                    } else {
                        targetedInstance = nil
                        GazeRouter.shared.setTarget(nil)
                    }
                }
            }
        } else {
            // Different cell — reset dwell timer
            pendingCellIndex = cellIndex
            dwellStartTime = Date()
            isDwelling = false
        }
    }

    /// Reset targeting state.
    func reset() {
        targetedCellIndex = nil
        targetedInstance = nil
        pendingCellIndex = nil
        dwellStartTime = nil
        isDwelling = false
        currentGazePoint = nil
    }
}
