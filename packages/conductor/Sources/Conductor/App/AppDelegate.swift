// AppDelegate.swift — #conductor-app
// NSApplicationDelegate managing lifecycle, menu bar icon, and the floating panel.
// Single owner of InputOrchestrator and WorkspaceManager — all stateful components
// have exactly one lifecycle owner (~single-owner).

import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var conductorPanel: ConductorPanel?
    private let permissionsManager = PermissionsManager()
    private lazy var gazeCursor = GazeCursorController()
    private lazy var gestureConfirmation = GestureConfirmationController()
    private let hotKeyManager = HotKeyManager()

    // MARK: - Owned State (single-owner pattern)

    let workspaceManager = WorkspaceManager()
    let buffer = BufferEngine()
    private(set) lazy var orchestrator: InputOrchestrator = InputOrchestrator(
        buffer: buffer,
        gazeRouter: GazeRouter.shared
    )

    // MARK: - Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        ConductorLog.app.info("Conductor launching")

        // Hide dock icon — Conductor is a menu bar + overlay app
        NSApp.setActivationPolicy(.accessory)

        setupMenuBar()
        setupOrchestrator()
        setupHotKeys()
        checkPermissionsAndLaunch()

        // Listen for calibration requests from Settings / banner / setup wizard
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRecalibrate),
            name: .conductorRecalibrate,
            object: nil
        )

        // Listen for eyebrow calibration requests
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleCalibrateEyebrows),
            name: .conductorCalibrateEyebrows,
            object: nil
        )

        // Watch for preference changes (gaze overlay, provider toggles)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDefaultsChange),
            name: UserDefaults.didChangeNotification,
            object: nil
        )
    }

    // MARK: - Orchestrator Setup ($orchestrator-startup)

    /// Wire workspace, create providers from preferences, start orchestration.
    private func setupOrchestrator() {
        orchestrator.setWorkspaceManager(workspaceManager)

        // Read provider preferences and create providers conditionally
        createProvidersFromPreferences()

        // Read eyebrow preference
        let eyebrowEnabled = UserDefaults.standard.bool(forKey: "eyebrowEnabled")
        orchestrator.setEyebrowEnabled(eyebrowEnabled)

        orchestrator.start()
        ConductorLog.flow("orchestrator-startup")
            .info("Orchestrator started — ^providers-ready")
    }

    /// Create/destroy input providers based on UserDefaults preferences.
    /// All vision providers share the orchestrator's SharedCameraSession.
    private func createProvidersFromPreferences() {
        let gazeEnabled = UserDefaults.standard.bool(forKey: "gazeEnabled")
        let gestureEnabled = UserDefaults.standard.bool(forKey: "gestureEnabled")
        let voiceEnabled = UserDefaults.standard.bool(forKey: "voiceEnabled")

        if gazeEnabled && orchestrator.gazeProvider == nil {
            let provider = VisionGazeProvider()
            provider.setSharedCamera(orchestrator.sharedCamera)
            orchestrator.gazeProvider = provider
            ConductorLog.component("conductor-app").info("Created gaze provider (native Vision)")
        } else if !gazeEnabled && orchestrator.gazeProvider != nil {
            orchestrator.gazeProvider = nil
            ConductorLog.component("conductor-app").info("Removed gaze provider")
        }

        if gestureEnabled && orchestrator.gestureProvider == nil {
            let provider = VisionGestureProvider()
            provider.setSharedCamera(orchestrator.sharedCamera)
            orchestrator.gestureProvider = provider
            ConductorLog.component("conductor-app").info("Created gesture provider")
        } else if !gestureEnabled && orchestrator.gestureProvider != nil {
            orchestrator.gestureProvider = nil
            ConductorLog.component("conductor-app").info("Removed gesture provider")
        }

        if voiceEnabled && orchestrator.voiceProvider == nil {
            orchestrator.voiceProvider = WhisperVoiceProvider()
            ConductorLog.component("conductor-app").info("Created voice provider")
        } else if !voiceEnabled && orchestrator.voiceProvider != nil {
            orchestrator.voiceProvider = nil
            ConductorLog.component("conductor-app").info("Removed voice provider")
        }
    }

    /// Track previous preference values to detect actual changes.
    private var previousGazeEnabled: Bool?
    private var previousGestureEnabled: Bool?
    private var previousVoiceEnabled: Bool?
    private var previousEyebrowEnabled: Bool?

    @objc private func handleDefaultsChange() {
        // Gaze cursor overlay toggle
        let visible = UserDefaults.standard.bool(forKey: "gazeOverlayVisible")
        Task { @MainActor in
            if visible {
                if !gazeCursor.isActive {
                    gazeCursor.start(gazeRouter: GazeRouter.shared)
                }
            } else {
                gazeCursor.stop()
            }
        }

        // Gesture confirmation overlay toggle
        let gestureConfirmationEnabled = UserDefaults.standard.bool(forKey: "gestureConfirmationEnabled")
        Task { @MainActor in
            if gestureConfirmationEnabled {
                if !gestureConfirmation.isActive {
                    gestureConfirmation.start(orchestrator: orchestrator)
                }
            } else {
                gestureConfirmation.stop()
            }
        }

        // Provider preference changes — restart orchestrator if providers changed
        let gazeEnabled = UserDefaults.standard.bool(forKey: "gazeEnabled")
        let gestureEnabled = UserDefaults.standard.bool(forKey: "gestureEnabled")
        let voiceEnabled = UserDefaults.standard.bool(forKey: "voiceEnabled")
        let eyebrowEnabled = UserDefaults.standard.bool(forKey: "eyebrowEnabled")

        let providersChanged = gazeEnabled != previousGazeEnabled ||
            gestureEnabled != previousGestureEnabled ||
            voiceEnabled != previousVoiceEnabled ||
            eyebrowEnabled != previousEyebrowEnabled

        if providersChanged {
            previousGazeEnabled = gazeEnabled
            previousGestureEnabled = gestureEnabled
            previousVoiceEnabled = voiceEnabled
            previousEyebrowEnabled = eyebrowEnabled

            ConductorLog.component("conductor-app")
                .info("Provider preferences changed — reconfiguring orchestrator")
            orchestrator.stop()
            createProvidersFromPreferences()
            orchestrator.setEyebrowEnabled(eyebrowEnabled)
            orchestrator.start()
        }
    }

    /// Register global keyboard shortcuts for video/voice toggles and panel control.
    private func setupHotKeys() {
        hotKeyManager.register(.toggleVideo) { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                await self.orchestrator.toggleVideo()
            }
        }
        hotKeyManager.register(.toggleVoice) { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                await self.orchestrator.toggleVoice()
            }
        }
        ConductorLog.component("conductor-app").info("Global hotkeys registered (Cmd+Shift+V, Cmd+Shift+M)")
    }

    func applicationWillTerminate(_ notification: Notification) {
        ConductorLog.app.info("Conductor shutting down")
        hotKeyManager.unregisterAll()
        orchestrator.stop()
        workspaceManager.cleanup()
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
        let panel = ConductorPanel(
            sidebarMode: true,
            side: workspaceManager.sidebarSide,
            width: workspaceManager.sidebarWidth
        )
        panel.contentView = NSHostingView(
            rootView: MainOverlayView(
                showOnboarding: showOnboarding,
                permissionStatus: permissionStatus ?? permissionsManager.checkAll(),
                orchestrator: orchestrator,
                workspaceManager: workspaceManager
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
            let gazeStream: AsyncStream<CGPoint>

            if let provider = orchestrator.gazeProvider {
                // Use the real gaze provider stream
                if !provider.isActive {
                    ConductorLog.component("gaze-calibration")
                        .info("Starting gaze provider temporarily for calibration")
                    try? await provider.start()
                }
                gazeStream = provider.gazePointStream
            } else {
                // No gaze provider — use simulated center points so UI flow works
                ConductorLog.component("gaze-calibration")
                    .info("No gaze provider — using simulated calibration data")
                gazeStream = AsyncStream<CGPoint> { continuation in
                    Task {
                        while !Task.isCancelled {
                            continuation.yield(CGPoint(x: 0.5, y: 0.5))
                            try? await Task.sleep(for: .milliseconds(33))
                        }
                        continuation.finish()
                    }
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

    // MARK: - Eyebrow Calibration (Phase 5)

    @objc private func handleCalibrateEyebrows() {
        ConductorLog.component("eyebrow-calibration").info("Eyebrow calibration requested")
        Task { @MainActor in
            // Ensure gaze provider exists and is started (eyebrow data comes from face landmarks)
            if orchestrator.gazeProvider == nil {
                let provider = VisionGazeProvider()
                provider.setSharedCamera(orchestrator.sharedCamera)
                orchestrator.gazeProvider = provider
                ConductorLog.component("eyebrow-calibration").info("Created gaze provider for calibration")
            }
            if let provider = orchestrator.gazeProvider, !provider.isActive {
                ConductorLog.component("eyebrow-calibration").info("Starting gaze provider for calibration")
                try? await provider.start()
            }

            let eyebrowStream: AsyncStream<EyebrowFrame>? = orchestrator.gazeProvider?.eyebrowStream

            await EyebrowCalibrationWindowController.run(
                eyebrowStream: eyebrowStream,
                onComplete: { [weak self] raiseThreshold, lowerThreshold in
                    self?.orchestrator.eyebrowDetector.setThresholds(
                        raise: raiseThreshold,
                        lower: lowerThreshold
                    )
                    ConductorLog.signal("eyebrow-calibration-complete")
                        .info("Eyebrow thresholds applied — raise: \(raiseThreshold), lower: \(lowerThreshold)")
                }
            )
        }
    }
}
