// AppDelegate.swift — #conductor-app
// NSApplicationDelegate managing lifecycle, menu bar icon, and the floating panel.

import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var conductorPanel: ConductorPanel?
    private let permissionsManager = PermissionsManager()

    // MARK: - Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        ConductorLog.app.info("Conductor launching")

        // Hide dock icon — Conductor is a menu bar + overlay app
        NSApp.setActivationPolicy(.accessory)

        setupMenuBar()
        checkPermissionsAndLaunch()

        // Listen for calibration requests from Settings / banner / setup wizard
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRecalibrate),
            name: .conductorRecalibrate,
            object: nil
        )
    }

    func applicationWillTerminate(_ notification: Notification) {
        ConductorLog.app.info("Conductor shutting down")
        conductorPanel?.close()
    }

    // MARK: - Menu Bar

    private func setupMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem?.button {
            button.image = NSImage(
                systemSymbolName: "waveform.badge.mic",
                accessibilityDescription: "Paradigm Conductor"
            )
            button.image?.size = NSSize(width: 18, height: 18)
            button.action = #selector(togglePanel)
            button.target = self
        }

        let menu = NSMenu()
        menu.addItem(withTitle: "Show Conductor", action: #selector(showPanel), keyEquivalent: "")
        menu.addItem(withTitle: "Hide Conductor", action: #selector(hidePanel), keyEquivalent: "")
        menu.addItem(.separator())

        let permItem = NSMenuItem(title: "Check Permissions…", action: #selector(showPermissions), keyEquivalent: "")
        menu.addItem(permItem)

        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Conductor", action: #selector(quitApp), keyEquivalent: "q")

        statusItem?.menu = menu
    }

    // MARK: - Panel Management

    private func checkPermissionsAndLaunch() {
        let status = permissionsManager.checkAll()

        if status.allGranted {
            ConductorLog.app.info("All permissions granted — launching panel")
            launchPanel()
        } else {
            ConductorLog.app.info("Missing permissions — showing onboarding")
            launchPanel(showOnboarding: true, permissionStatus: status)
        }
    }

    private func launchPanel(showOnboarding: Bool = false, permissionStatus: PermissionStatus? = nil) {
        let panel = ConductorPanel()
        panel.contentView = NSHostingView(
            rootView: MainOverlayView(
                showOnboarding: showOnboarding,
                permissionStatus: permissionStatus ?? permissionsManager.checkAll()
            )
        )
        panel.makeKeyAndOrderFront(nil)
        self.conductorPanel = panel
    }

    // MARK: - Actions

    @objc private func togglePanel() {
        if conductorPanel?.isVisible == true {
            hidePanel()
        } else {
            showPanel()
        }
    }

    @objc private func showPanel() {
        if conductorPanel == nil {
            launchPanel()
        }
        conductorPanel?.makeKeyAndOrderFront(nil)
    }

    @objc private func hidePanel() {
        conductorPanel?.orderOut(nil)
    }

    @objc private func showPermissions() {
        launchPanel(showOnboarding: true, permissionStatus: permissionsManager.checkAll())
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    @objc private func handleRecalibrate() {
        ConductorLog.component("gaze-calibration").info("Calibration requested via notification")
        Task { @MainActor in
            // Create a placeholder gaze stream — the calibration overlay collects
            // screen target positions. Without a live gaze provider, we provide
            // simulated center-of-target iris points so the UI flow works.
            let gazeStream = AsyncStream<CGPoint> { continuation in
                // Emit center points at ~30fps so the calibration view has data
                Task {
                    while !Task.isCancelled {
                        // Simulated iris position (center of gaze) — actual gaze
                        // provider would feed real data here
                        continuation.yield(CGPoint(x: 0.5, y: 0.5))
                        try? await Task.sleep(for: .milliseconds(33))
                    }
                    continuation.finish()
                }
            }

            let result = await CalibrationWindowController.run(gazeStream: gazeStream)
            if let points = result, !points.isEmpty {
                UserDefaults.standard.set(true, forKey: "gazeCalibrated")
                ConductorLog.signal("calibration-complete")
                    .info("Gaze calibration completed with \(points.count) points")
            } else {
                ConductorLog.component("gaze-calibration").info("Calibration cancelled")
            }
        }
    }
}
