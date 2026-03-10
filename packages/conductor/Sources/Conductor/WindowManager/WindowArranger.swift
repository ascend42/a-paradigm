// WindowArranger.swift — #window-arranger
// AXUIElement-based window tiling and layout management.

import AppKit
import ApplicationServices

/// macOS implementation of window arrangement using Accessibility API.
final class AXWindowArranger: WindowArrangerProtocol {

    func applyLayout(_ layout: WindowLayout, to instances: [ClaudeCodeInstance]) throws {
        guard !instances.isEmpty else { return }

        let screen = usableScreenFrame()
        let frames = computeFrames(layout: layout, count: instances.count, screen: screen)

        for (index, instance) in instances.enumerated() where index < frames.count {
            try setFrame(frames[index], for: instance)
        }

        ConductorLog.signal("layout-applied")
            .info("Applied \(layout.rawValue) layout to \(instances.count) windows")
    }

    func setFrame(_ frame: CGRect, for instance: ClaudeCodeInstance) throws {
        let app = AXUIElementCreateApplication(instance.processID)

        // Find the window with matching ID
        var windowsRef: AnyObject?
        let result = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef)
        guard result == .success, let windows = windowsRef as? [AXUIElement] else {
            throw WindowArrangerError.cannotAccessWindows
        }

        // Find our specific window
        for window in windows {
            var position = CGPoint(x: frame.origin.x, y: frame.origin.y)
            var size = CGSize(width: frame.width, height: frame.height)

            if let posValue = AXValueCreate(.cgPoint, &position),
               let sizeValue = AXValueCreate(.cgSize, &size) {
                AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, posValue)
                AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
            }
            // For simplicity, move the first window found for this PID
            break
        }
    }

    func usableScreenFrame() -> CGRect {
        NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1920, height: 1080)
    }

    // MARK: - Layout Computation

    private func computeFrames(layout: WindowLayout, count: Int, screen: CGRect) -> [CGRect] {
        // Reserve space for the Conductor panel on the right
        let panelWidth: CGFloat = 340
        let available = CGRect(
            x: screen.origin.x,
            y: screen.origin.y,
            width: screen.width - panelWidth,
            height: screen.height
        )
        let gap: CGFloat = 4

        switch layout {
        case .focused:
            return [available]

        case .sideBySide:
            let halfWidth = (available.width - gap) / 2
            return [
                CGRect(x: available.minX, y: available.minY,
                       width: halfWidth, height: available.height),
                CGRect(x: available.minX + halfWidth + gap, y: available.minY,
                       width: halfWidth, height: available.height),
            ]

        case .threeUp:
            let leftWidth = available.width * 0.6
            let rightWidth = available.width - leftWidth - gap
            let halfHeight = (available.height - gap) / 2
            return [
                // Large left
                CGRect(x: available.minX, y: available.minY,
                       width: leftWidth, height: available.height),
                // Top right
                CGRect(x: available.minX + leftWidth + gap,
                       y: available.minY + halfHeight + gap,
                       width: rightWidth, height: halfHeight),
                // Bottom right
                CGRect(x: available.minX + leftWidth + gap,
                       y: available.minY,
                       width: rightWidth, height: halfHeight),
            ]

        case .grid:
            let cols = count <= 2 ? count : 2
            let rows = (count + cols - 1) / cols
            let cellWidth = (available.width - CGFloat(cols - 1) * gap) / CGFloat(cols)
            let cellHeight = (available.height - CGFloat(rows - 1) * gap) / CGFloat(rows)

            var frames: [CGRect] = []
            for i in 0..<count {
                let col = i % cols
                let row = i / cols
                frames.append(CGRect(
                    x: available.minX + CGFloat(col) * (cellWidth + gap),
                    y: available.maxY - CGFloat(row + 1) * cellHeight - CGFloat(row) * gap,
                    width: cellWidth,
                    height: cellHeight
                ))
            }
            return frames
        }
    }
}

enum WindowArrangerError: Error, LocalizedError {
    case cannotAccessWindows

    var errorDescription: String? {
        "Cannot access window list via Accessibility API. Check permissions."
    }
}
