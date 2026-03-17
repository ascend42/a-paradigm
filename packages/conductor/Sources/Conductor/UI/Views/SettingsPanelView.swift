// SettingsPanelView.swift — #settings-panel
// Preferences: hotkeys, gesture config, enrichment toggles, camera selection.

import SwiftUI

struct SettingsPanelView: View {
    @AppStorage("voiceMode") private var voiceMode: String = "pushToTalk"
    @AppStorage("gestureEnabled") private var gestureEnabled: Bool = true
    @AppStorage("gazeEnabled") private var gazeEnabled: Bool = true
    @AppStorage("eyebrowEnabled") private var eyebrowEnabled: Bool = false
    @AppStorage("eyebrowSensitivity") private var eyebrowSensitivity: Double = 0.035
    @AppStorage("enrichmentEnabled") private var enrichmentEnabled: Bool = true
    @AppStorage("detectionFPS") private var detectionFPS: Double = 15
    @AppStorage("dwellDuration") private var dwellDuration: Double = 0.5
    @AppStorage("gazeOverlayVisible") private var gazeOverlayVisible: Bool = false
    @AppStorage("gestureConfirmationEnabled") private var gestureConfirmationEnabled: Bool = false
    @AppStorage("pollingInterval") private var pollingInterval: Double = 2.0

    var workspaceManager: WorkspaceManager?
    var actionRegistry: ActionRegistry?
    var voiceCommandRegistry: VoiceCommandRegistry?
    var customGestureClassifier: CustomGestureClassifier?
    var agentPartManager: AgentPartManager?
    var noteRelay: NoteRelay?
    var projectStore: ProjectStore?
    var agentProcessManager: AgentProcessManager?
    var sentinelClient: SentinelWSClient?
    var eyebrowBindingRegistry: EyebrowBindingRegistry?
    var hotKeyBindingRegistry: HotKeyBindingRegistry?

    var body: some View {
        TabView {
            generalTab
                .tabItem { Label("General", systemImage: "gear") }
            inputTab
                .tabItem { Label("Input", systemImage: "hand.raised") }
            enrichmentTab
                .tabItem { Label("Context", systemImage: "text.badge.plus") }
            if let manager = workspaceManager {
                WorkspaceSettingsView(workspaceManager: manager)
                    .tabItem { Label("Workspace", systemImage: "square.grid.2x2") }
            }
            if let registry = actionRegistry, let voiceCmds = voiceCommandRegistry, let gestureClassifier = customGestureClassifier {
                BindingsManagerView(
                    actionRegistry: registry,
                    voiceCommandRegistry: voiceCmds,
                    customGestureClassifier: gestureClassifier,
                    eyebrowBindingRegistry: eyebrowBindingRegistry,
                    hotKeyBindingRegistry: hotKeyBindingRegistry
                )
                .tabItem { Label("Bindings", systemImage: "keyboard") }
            }
            if let partManager = agentPartManager, let relay = noteRelay {
                SymphonySettingsView(partManager: partManager, relay: relay)
                    .tabItem { Label("Symphony", systemImage: "music.quarternote.3") }
            }
            if let store = projectStore, let manager = agentProcessManager {
                SessionsSettingsView(projectStore: store, agentProcessManager: manager)
                    .tabItem { Label("Sessions", systemImage: "bolt.fill") }
            }
            if let sentinel = sentinelClient {
                monitoringTab(sentinel)
                    .tabItem { Label("Monitoring", systemImage: "antenna.radiowaves.left.and.right") }
            }
        }
        .frame(width: 450, height: 400)
        .padding()
    }

    // MARK: - General

    private var generalTab: some View {
        Form {
            Section("Window Detection") {
                HStack {
                    Text("Polling interval")
                    Spacer()
                    Slider(value: $pollingInterval, in: 1...10, step: 0.5)
                        .frame(width: 150)
                    Text("\(pollingInterval, specifier: "%.1f")s")
                        .monospacedDigit()
                        .frame(width: 36)
                }
            }

            Section("Setup") {
                Button("Run Setup Wizard Again\u{2026}") {
                    UserDefaults.standard.set(false, forKey: "setupComplete")
                    NotificationCenter.default.post(name: .conductorRunSetup, object: nil)
                }
            }

            Section("Hotkeys") {
                LabeledContent("Toggle Panel") {
                    hotkeyBadge("Cmd+Shift+C")
                }
                LabeledContent("Toggle Video") {
                    hotkeyBadge("Cmd+Shift+V")
                }
                LabeledContent("Toggle Voice") {
                    hotkeyBadge("Cmd+Shift+M")
                }
                LabeledContent("Push to Talk") {
                    hotkeyBadge("F5")
                }
                LabeledContent("Window Layouts") {
                    hotkeyBadge("Cmd+1–4")
                }
            }
        }
    }

    private func hotkeyBadge(_ text: String) -> some View {
        Text(text)
            .font(.caption.monospaced())
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 4).fill(.quaternary))
    }

    // MARK: - Input

    private var inputTab: some View {
        Form {
            Section("Voice") {
                Picker("Mode", selection: $voiceMode) {
                    Text("Push to Talk").tag("pushToTalk")
                    Text("Continuous").tag("continuous")
                    Text("Eyebrow Trigger").tag("eyebrowTrigger")
                }
            }

            Section("Eyebrow Control") {
                Toggle("Enable eyebrow voice control", isOn: $eyebrowEnabled)
                if eyebrowEnabled {
                    HStack {
                        Text("Sensitivity")
                        Spacer()
                        Slider(value: $eyebrowSensitivity, in: 0.015...0.06, step: 0.005)
                            .frame(width: 150)
                        Text("\(eyebrowSensitivity, specifier: "%.3f")")
                            .monospacedDigit()
                            .frame(width: 42)
                    }
                    Text("Lower = more sensitive. Raise left eyebrow to start voice, raise again to stop, raise right to send.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    Button("Calibrate Eyebrows\u{2026}") {
                        NotificationCenter.default.post(name: .conductorCalibrateEyebrows, object: nil)
                    }
                }
            }

            Section("Gestures") {
                Toggle("Enable hand gestures", isOn: $gestureEnabled)
                if gestureEnabled {
                    HStack {
                        Text("Detection FPS")
                        Spacer()
                        Slider(value: $detectionFPS, in: 5...30, step: 1)
                            .frame(width: 150)
                        Text("\(Int(detectionFPS))")
                            .monospacedDigit()
                            .frame(width: 24)
                    }
                }
                Toggle("Show gesture confirmation overlay", isOn: $gestureConfirmationEnabled)
                if gestureConfirmationEnabled {
                    Text("Shows a top-center toast when a gesture, eyebrow event, or voice command is recognized. Great for practice.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Gaze") {
                Toggle("Enable gaze tracking", isOn: $gazeEnabled)
                if gazeEnabled {
                    HStack {
                        Text("Dwell duration")
                        Spacer()
                        Slider(value: $dwellDuration, in: 0.2...2.0, step: 0.1)
                            .frame(width: 150)
                        Text("\(dwellDuration, specifier: "%.1f")s")
                            .monospacedDigit()
                            .frame(width: 36)
                    }

                    Toggle("Show gaze cursor", isOn: $gazeOverlayVisible)

                    Button("Recalibrate…") {
                        NotificationCenter.default.post(name: .conductorRecalibrate, object: nil)
                    }
                }
            }
        }
    }

    // MARK: - Monitoring

    @AppStorage("sentinelAutoConnect") private var sentinelAutoConnect: Bool = false
    @AppStorage("sentinelURL") private var sentinelURL: String = "ws://localhost:3838/ws"

    private func monitoringTab(_ sentinel: SentinelWSClient) -> some View {
        Form {
            Section("Sentinel WebSocket") {
                HStack {
                    Text("URL")
                    Spacer()
                    TextField("ws://...", text: $sentinelURL)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 220)
                        .onSubmit {
                            if let url = URL(string: sentinelURL) {
                                sentinel.serverURL = url
                            }
                        }
                }

                Toggle("Auto-connect on launch", isOn: $sentinelAutoConnect)

                LabeledContent("Status") {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(sentinel.isConnected ? .green : .red)
                            .frame(width: 6, height: 6)
                        Text(sentinel.isConnected ? "Connected" : "Disconnected")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                LabeledContent("Buffered Events") {
                    Text("\(sentinel.recentEvents.count) / 200")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Enrichment

    private var enrichmentTab: some View {
        Form {
            Section("Paradigm Context") {
                Toggle("Enrich dispatched text with project context", isOn: $enrichmentEnabled)

                if enrichmentEnabled {
                    Text("Conductor will append Paradigm status, relevant symbols, and git diff to dispatched text.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Cache") {
                LabeledContent("TTL") {
                    Text("30 seconds")
                        .foregroundStyle(.secondary)
                }
                Text("Matches paradigm-mcp tool cache for consistency.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

// MARK: - Notifications

extension Notification.Name {
    /// Posted by SettingsPanelView to request gaze recalibration.
    static let conductorRecalibrate = Notification.Name("com.a-company.conductor.recalibrate")

    /// Posted by SettingsPanelView to re-run the setup wizard.
    static let conductorRunSetup = Notification.Name("com.a-company.conductor.runSetup")

    /// Posted by SettingsPanelView to start eyebrow calibration.
    static let conductorCalibrateEyebrows = Notification.Name("com.a-company.conductor.calibrateEyebrows")
}
