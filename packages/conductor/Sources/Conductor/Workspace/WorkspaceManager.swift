// WorkspaceManager.swift — #workspace-manager
// Owns managed CC instances, grid layout, and terminal lifecycle.
// Central source of truth for Conductor-launched instances.

import AppKit
import Foundation

/// Manages Conductor-launched Claude Code instances and their grid layout.
@MainActor
final class WorkspaceManager: ObservableObject {

    // MARK: - Published State

    @Published private(set) var managedInstances: [ManagedInstance] = []
    @Published var sidebarSide: WorkspaceGrid.SidebarSide = .left
    @Published var sidebarWidth: CGFloat = 320
    @Published var maxInstances: Int = 6
    @Published var autoArrange: Bool = true
    @Published var defaultTerminal: TerminalApp

    // MARK: - Private

    private let arranger = AXWindowArranger()
    private var processMonitorTask: Task<Void, Never>?

    // MARK: - Init

    init() {
        let savedSide = UserDefaults.standard.string(forKey: "sidebarSide") ?? "left"
        self.sidebarSide = WorkspaceGrid.SidebarSide(rawValue: savedSide) ?? .left
        self.sidebarWidth = CGFloat(UserDefaults.standard.double(forKey: "sidebarWidth").nonZero ?? 320)
        self.maxInstances = UserDefaults.standard.integer(forKey: "maxInstances").nonZero ?? 6
        self.autoArrange = UserDefaults.standard.object(forKey: "autoArrange") == nil
            ? true : UserDefaults.standard.bool(forKey: "autoArrange")
        let savedTerminal = UserDefaults.standard.string(forKey: "defaultTerminal") ?? ""
        self.defaultTerminal = TerminalApp(rawValue: savedTerminal) ?? TerminalLauncher.detectDefaultTerminal()
    }

    // MARK: - Instance Management

    /// Launch a new Claude Code instance in the workspace.
    func launchInstance(projectDir: String, label: String) async throws {
        guard managedInstances.count < maxInstances else {
            throw WorkspaceError.maxInstancesReached(maxInstances)
        }

        let gridIndex = managedInstances.count
        let terminal = defaultTerminal

        ConductorLog.flow("workspace-launch")
            .info("Launching instance in \(terminal.rawValue) at \(projectDir)")

        let launched = try await TerminalLauncher.launch(
            terminal: terminal,
            projectDirectory: projectDir,
            label: label
        )

        let managed = ManagedInstance(
            id: "managed-\(launched.processID)-\(gridIndex)",
            instance: nil,
            gridIndex: gridIndex,
            label: label,
            terminalApp: terminal,
            launchedAt: .now,
            projectDirectory: projectDir,
            processID: launched.processID,
            windowIdentifier: launched.windowIdentifier
        )

        managedInstances.append(managed)
        ConductorLog.signal("instance-launched")
            .info("Instance launched: \(label) (PID \(launched.processID))")

        if autoArrange {
            rearrange()
        }

        startProcessMonitoring()
    }

    /// Close and remove a managed instance.
    /// Uses AppleScript targeted close for Terminal.app/iTerm2 to avoid killing all windows.
    func closeInstance(_ instance: ManagedInstance) {
        TerminalLauncher.closeWindow(
            terminal: instance.terminalApp,
            windowIdentifier: instance.windowIdentifier,
            processID: instance.processID
        )

        managedInstances.removeAll { $0.id == instance.id }

        // Reassign grid indices
        for i in managedInstances.indices {
            managedInstances[i].gridIndex = i
        }

        ConductorLog.signal("instance-closed")
            .info("Instance closed: \(instance.label)")

        if autoArrange {
            rearrange()
        }
    }

    /// Rearrange all managed instance windows according to the grid.
    func rearrange() {
        let grid = currentGrid()

        for managed in managedInstances {
            guard let ccInstance = managed.instance else { continue }
            let frame = grid.cellFrame(at: managed.gridIndex)
            do {
                try arranger.setFrame(frame, for: ccInstance)
            } catch {
                ConductorLog.component("workspace-manager")
                    .error("Failed to arrange \(managed.label): \(error.localizedDescription)")
            }
        }

        ConductorLog.signal("layout-changed")
            .info("Workspace rearranged: \(self.managedInstances.count) instances")
    }

    /// Get the current grid configuration.
    func currentGrid() -> WorkspaceGrid {
        let screen = NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1920, height: 1080)
        return WorkspaceGrid(
            screenBounds: screen,
            sidebarWidth: sidebarWidth,
            sidebarSide: sidebarSide,
            instanceCount: managedInstances.count,
            gap: 4
        )
    }

    /// Link a detected ClaudeCodeInstance to a managed instance by PID match.
    func linkDetectedInstance(_ detected: ClaudeCodeInstance) {
        for i in managedInstances.indices {
            if managedInstances[i].processID == detected.processID && managedInstances[i].instance == nil {
                managedInstances[i].instance = detected
                ConductorLog.component("workspace-manager")
                    .info("Linked \(detected.title) to managed instance \(self.managedInstances[i].label)")
                if autoArrange {
                    rearrange()
                }
                break
            }
        }
    }

    // MARK: - Settings Persistence

    func saveSettings() {
        UserDefaults.standard.set(sidebarSide.rawValue, forKey: "sidebarSide")
        UserDefaults.standard.set(Double(sidebarWidth), forKey: "sidebarWidth")
        UserDefaults.standard.set(maxInstances, forKey: "maxInstances")
        UserDefaults.standard.set(autoArrange, forKey: "autoArrange")
        UserDefaults.standard.set(defaultTerminal.rawValue, forKey: "defaultTerminal")
    }

    // MARK: - Process Monitoring

    private func startProcessMonitoring() {
        guard processMonitorTask == nil else { return }

        processMonitorTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard let self else { break }

                var removedAny = false
                for instance in self.managedInstances where !instance.isAlive {
                    ConductorLog.signal("instance-closed")
                        .info("Process terminated: \(instance.label)")
                    removedAny = true
                }

                if removedAny {
                    self.managedInstances.removeAll { !$0.isAlive }
                    for i in self.managedInstances.indices {
                        self.managedInstances[i].gridIndex = i
                    }
                    if self.autoArrange {
                        self.rearrange()
                    }
                }

                if self.managedInstances.isEmpty {
                    self.processMonitorTask?.cancel()
                    self.processMonitorTask = nil
                    break
                }
            }
        }
    }

    // MARK: - Cleanup

    func cleanup() {
        processMonitorTask?.cancel()
        processMonitorTask = nil

        // Close all managed instance windows (targeted, not kill-all)
        for instance in managedInstances {
            TerminalLauncher.closeWindow(
                terminal: instance.terminalApp,
                windowIdentifier: instance.windowIdentifier,
                processID: instance.processID
            )
        }
        managedInstances.removeAll()
    }
}

// MARK: - Errors

enum WorkspaceError: Error, LocalizedError {
    case maxInstancesReached(Int)

    var errorDescription: String? {
        switch self {
        case .maxInstancesReached(let max):
            return "Maximum of \(max) instances reached"
        }
    }
}

// MARK: - Helpers

private extension Double {
    var nonZero: Double? {
        self != 0 ? self : nil
    }
}

private extension Int {
    var nonZero: Int? {
        self != 0 ? self : nil
    }
}
