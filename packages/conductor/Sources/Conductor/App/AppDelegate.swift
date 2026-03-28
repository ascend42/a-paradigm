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
    private var containerWindow: ContainerWindow?
    /// Container mode — launched via `paradigm conductor --container`
    @AppStorage("useContainerMode") var useContainerMode: Bool = false
    private let permissionsManager = PermissionsManager()
    private lazy var gazeCursor = GazeCursorController()
    private lazy var gestureConfirmation = GestureConfirmationController()
    private let hotKeyManager = HotKeyManager()

    // MARK: - Owned State (single-owner pattern)

    let workspaceManager = WorkspaceManager()
    let buffer = BufferEngine()
    let projectStore = ProjectStore()
    let agentProcessManager = AgentProcessManager()
    let agentGroupStore = AgentGroupStore()
    let symphonyMonitor = SymphonyMonitor()
    let taskStore = TaskStore()
    let sentinelClient = SentinelWSClient()
    let agentHealthMonitor = AgentHealthMonitor()
    let threadWatcher = SymphonyThreadWatcher()
    let symphonyNotifications = SymphonyNotificationManager()
    let terminalSessionManager = TerminalSessionManager()
    let hotKeyBindingRegistry = HotKeyBindingRegistry()
    let eyebrowBindingRegistry = EyebrowBindingRegistry()
    private(set) lazy var orchestrator: InputOrchestrator = InputOrchestrator(
        buffer: buffer,
        gazeRouter: GazeRouter.shared
    )

    // MARK: - Symphony Components (single-owner)

    let agentPartManager = AgentPartManager()
    let noteRelay = NoteRelay()
    let fileApprovalManager = FileApprovalManager()
    private(set) lazy var autoLinkCoordinator = AutoLinkCoordinator(
        partManager: agentPartManager,
        relay: noteRelay
    )

    // MARK: - Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        ConductorLog.app.info("Conductor launching")

        // Workspace mode: show in Dock and Cmd+Tab. Overlay mode: menu bar only.
        if useContainerMode {
            NSApp.setActivationPolicy(.regular)
        } else {
            NSApp.setActivationPolicy(.accessory)
        }

        setupMenuBar()
        setupMainMenu()
        setupGlobalShortcuts()
        setupOrchestrator()
        setupSymphony()
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

    // MARK: - Symphony Setup ($symphony-startup)

    /// Initialize Symphony components: auto-link + note relay.
    private func setupSymphony() {
        ScoreIO.ensureScoreDirs()
        agentPartManager.cleanStaleAgents()

        // Wire task store to symphony monitor for task tracking
        symphonyMonitor.taskStore = taskStore

        // Wire agent health monitor to task store
        agentHealthMonitor.configure(taskStore: taskStore)

        // Start monitoring grouped agents for detailed status tracking
        let allGrouped = agentGroupStore.allGroupedAgents
        if !allGrouped.isEmpty {
            symphonyMonitor.startPolling(agents: allGrouped)
        }

        // Wire notification manager to thread watcher
        threadWatcher.notificationManager = symphonyNotifications

        // Wire terminal session manager to Symphony components
        terminalSessionManager.agentPartManager = agentPartManager
        terminalSessionManager.threadWatcher = threadWatcher

        // Start thread watcher with ALL agents across ALL projects (multi-workspace)
        let globalAgentIds = SymphonyThreadWatcher.discoverAllAgentIds()
        let groupedIds = allGrouped.map(\.symphonyAgentId)
        let allIds = Array(Set(globalAgentIds + groupedIds))
        if !allIds.isEmpty {
            threadWatcher.startWatching(agentIds: allIds)
        }

        // Auto-link will start monitoring the detector once it's available
        // (after permissions are granted and detection starts)
        ConductorLog.flow("symphony-startup")
            .info("Symphony components initialized")
    }

    /// Called after detection starts to wire auto-link to the detector.
    private func startSymphonyAutoLink(detector: ClaudeCodeDetector) {
        autoLinkCoordinator.start(detector: detector)
        ConductorLog.signal("symphony-relay-started")
            .info("Symphony auto-link active")
    }

    // MARK: - Orchestrator Setup ($orchestrator-startup)

    /// Wire workspace, create providers from preferences, start orchestration.
    private func setupOrchestrator() {
        orchestrator.setWorkspaceManager(workspaceManager)
        orchestrator.fileApprovalManager = fileApprovalManager
        orchestrator.eyebrowBindingRegistry = eyebrowBindingRegistry

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

    /// Register global keyboard shortcuts from the binding registry.
    private func setupHotKeys() {
        hotKeyManager.observeRegistry(hotKeyBindingRegistry) { [weak self] action in
            guard let self else { return }
            Task { @MainActor in
                await self.orchestrator.executeAction(action)
            }
        }
        ConductorLog.component("conductor-app").info("Global hotkeys registered from registry")
    }

    func applicationWillTerminate(_ notification: Notification) {
        ConductorLog.app.info("Conductor shutting down")
        autoLinkCoordinator.stop()
        noteRelay.stop()
        symphonyMonitor.stopPolling()
        threadWatcher.stopWatching()
        hotKeyManager.unregisterAll()
        orchestrator.stop()
        agentProcessManager.cleanup()
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
        let containerItem = NSMenuItem(title: "Switch to Container Mode", action: #selector(switchToContainer), keyEquivalent: "")
        menu.addItem(containerItem)
        let sidebarItem = NSMenuItem(title: "Switch to Sidebar Mode", action: #selector(switchToSidebar), keyEquivalent: "")
        menu.addItem(sidebarItem)

        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Conductor", action: #selector(quitApp), keyEquivalent: "q")

        statusItem?.menu = menu
    }

    // MARK: - Main Menu (Application-Level Key Equivalents)

    /// Set up the application main menu with keyboard shortcuts.
    /// NSMenu key equivalents fire before any view's keyDown, so they work
    /// even when SwiftTerm has focus and would otherwise consume the event.
    private func setupMainMenu() {
        let mainMenu = NSMenu()

        // App menu
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Conductor", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Conductor", action: #selector(quitApp), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // View menu (font size + sidebar)
        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")

        let zoomIn = NSMenuItem(title: "Increase Font Size", action: #selector(handleZoomIn), keyEquivalent: "=")
        zoomIn.keyEquivalentModifierMask = .command
        viewMenu.addItem(zoomIn)

        let zoomOut = NSMenuItem(title: "Decrease Font Size", action: #selector(handleZoomOut), keyEquivalent: "-")
        zoomOut.keyEquivalentModifierMask = .command
        viewMenu.addItem(zoomOut)

        viewMenu.addItem(.separator())

        let toggleSidebar = NSMenuItem(title: "Toggle Sidebar", action: nil, keyEquivalent: "\\")
        toggleSidebar.keyEquivalentModifierMask = .command
        viewMenu.addItem(toggleSidebar)

        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        // Session menu
        let sessionMenuItem = NSMenuItem()
        let sessionMenu = NSMenu(title: "Session")

        let newSession = NSMenuItem(title: "New Session", action: nil, keyEquivalent: "t")
        newSession.keyEquivalentModifierMask = .command
        sessionMenu.addItem(newSession)

        let closeSession = NSMenuItem(title: "Close Session", action: nil, keyEquivalent: "w")
        closeSession.keyEquivalentModifierMask = .command
        sessionMenu.addItem(closeSession)

        sessionMenuItem.submenu = sessionMenu
        mainMenu.addItem(sessionMenuItem)

        NSApp.mainMenu = mainMenu
    }

    @objc private func handleZoomIn() {
        terminalSessionManager.increaseFontSize()
    }

    @objc private func handleZoomOut() {
        terminalSessionManager.decreaseFontSize()
    }

    /// Global keyboard shortcut monitor — fires before any view's keyDown.
    /// Handles Cmd+=/- for font sizing even when SwiftTerm has focus.
    private func setupGlobalShortcuts() {
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, event.modifierFlags.contains(.command) else { return event }
            guard let chars = event.charactersIgnoringModifiers else { return event }

            switch chars {
            case "=", "+":
                self.terminalSessionManager.increaseFontSize()
                return nil
            case "-":
                self.terminalSessionManager.decreaseFontSize()
                return nil
            default:
                return event
            }
        }
    }

    // MARK: - Panel Management

    private func checkPermissionsAndLaunch() {
        let status = permissionsManager.checkAll()

        if useContainerMode {
            ConductorLog.app.info("Launching in container mode")
            launchContainer()
        } else if status.allGranted {
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
        let env = ConductorEnvironment(
            orchestrator: orchestrator,
            workspaceManager: workspaceManager,
            noteRelay: noteRelay,
            fileApprovalManager: fileApprovalManager,
            projectStore: projectStore,
            agentProcessManager: agentProcessManager,
            agentGroupStore: agentGroupStore,
            symphonyMonitor: symphonyMonitor,
            agentPartManager: agentPartManager,
            taskStore: taskStore,
            sentinelClient: sentinelClient,
            agentHealthMonitor: agentHealthMonitor,
            threadWatcher: threadWatcher,
            symphonyNotifications: symphonyNotifications,
            terminalSessionManager: terminalSessionManager
        )
        panel.contentView = NSHostingView(
            rootView: MainOverlayView(
                showOnboarding: showOnboarding,
                permissionStatus: permissionStatus ?? permissionsManager.checkAll()
            )
            .environmentObject(env)
        )
        panel.makeKeyAndOrderFront(nil)
        self.conductorPanel = panel
    }

    /// Launch the container workspace window.
    private func launchContainer() {
        let container = ContainerWindow()
        container.onZoomIn = { [weak self] in self?.terminalSessionManager.increaseFontSize() }
        container.onZoomOut = { [weak self] in self?.terminalSessionManager.decreaseFontSize() }
        let env = ConductorEnvironment(
            orchestrator: orchestrator,
            workspaceManager: workspaceManager,
            noteRelay: noteRelay,
            fileApprovalManager: fileApprovalManager,
            projectStore: projectStore,
            agentProcessManager: agentProcessManager,
            agentGroupStore: agentGroupStore,
            symphonyMonitor: symphonyMonitor,
            agentPartManager: agentPartManager,
            taskStore: taskStore,
            sentinelClient: sentinelClient,
            agentHealthMonitor: agentHealthMonitor,
            threadWatcher: threadWatcher,
            symphonyNotifications: symphonyNotifications,
            terminalSessionManager: terminalSessionManager
        )
        container.contentView = NSHostingView(
            rootView: ContainerView()
                .environmentObject(env)
        )
        container.makeKeyAndOrderFront(nil)
        self.containerWindow = container

        ConductorLog.component("container-window")
            .info("Container workspace launched")
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

    @objc private func switchToContainer() {
        conductorPanel?.close()
        conductorPanel = nil
        useContainerMode = true
        launchContainer()
    }

    @objc private func switchToSidebar() {
        containerWindow?.close()
        containerWindow = nil
        useContainerMode = false
        launchPanel()
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

            let result = await CalibrationWindowController.run(rawIrisStream: gazeStream)
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
