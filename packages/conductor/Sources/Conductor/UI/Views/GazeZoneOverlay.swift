// GazeZoneOverlay.swift — #gaze-zone-router
// Transparent fullscreen overlay showing grid zone boundaries and active zone highlight.
// Debug/calibration toggle.

import SwiftUI

struct GazeZoneOverlay: View {
    @ObservedObject var workspaceManager: WorkspaceManager
    @ObservedObject var gazeZoneRouter: GazeZoneRouter
    @AppStorage("gazeOverlayVisible") private var visible: Bool = false

    var body: some View {
        if visible {
            GeometryReader { geo in
                let grid = workspaceManager.currentGrid()
                let scaleX = geo.size.width / grid.screenBounds.width
                let scaleY = geo.size.height / grid.screenBounds.height

                ZStack {
                    // Grid cell boundaries
                    ForEach(0..<workspaceManager.managedInstances.count, id: \.self) { index in
                        let cellRect = grid.cellFrame(at: index)
                        let isTargeted = gazeZoneRouter.targetedCellIndex == index

                        Rectangle()
                            .stroke(
                                isTargeted ? Color.green : Color.white.opacity(0.3),
                                lineWidth: isTargeted ? 3 : 1
                            )
                            .background(
                                isTargeted ? Color.green.opacity(0.05) : Color.clear
                            )
                            .frame(
                                width: cellRect.width * scaleX,
                                height: cellRect.height * scaleY
                            )
                            .position(
                                x: (cellRect.midX - grid.screenBounds.minX) * scaleX,
                                y: geo.size.height - (cellRect.midY - grid.screenBounds.minY) * scaleY
                            )

                        // Cell label
                        Text("\(index + 1)")
                            .font(.title.bold())
                            .foregroundStyle(isTargeted ? .green : .white.opacity(0.3))
                            .position(
                                x: (cellRect.midX - grid.screenBounds.minX) * scaleX,
                                y: geo.size.height - (cellRect.midY - grid.screenBounds.minY) * scaleY
                            )
                    }

                    // Gaze point indicator
                    if let point = gazeZoneRouter.currentGazePoint {
                        Circle()
                            .fill(gazeZoneRouter.isDwelling ? Color.green : Color.orange)
                            .frame(width: 12, height: 12)
                            .position(
                                x: (point.x - grid.screenBounds.minX) * scaleX,
                                y: geo.size.height - (point.y - grid.screenBounds.minY) * scaleY
                            )
                    }
                }
            }
            .allowsHitTesting(false)
        }
    }
}
