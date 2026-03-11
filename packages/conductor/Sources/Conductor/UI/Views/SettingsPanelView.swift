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
    @AppStorage("pollingInterval") private var pollingInterval: Double = 2.0

    var workspaceManager: WorkspaceManager?
    var actionRegistry: ActionRegistry?
    var voiceCommandRegistry: VoiceCommandRegistry?
    var customGestureClassifier: CustomGestureClassifier?

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
                    customGestureClassifier: gestureClassifier
                )
                .tabItem { Label("Bindings", systemImage: "keyboard") }
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
                    Text("Cmd+Shift+C")
                        .font(.caption.monospaced())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 4).fill(.quaternary))
                }
                LabeledContent("Push to Talk") {
                    Text("F5")
                        .font(.caption.monospaced())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 4).fill(.quaternary))
                }
                LabeledContent("Window Layouts") {
                    Text("Cmd+1–4")
                        .font(.caption.monospaced())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 4).fill(.quaternary))
                }
            }
        }
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
