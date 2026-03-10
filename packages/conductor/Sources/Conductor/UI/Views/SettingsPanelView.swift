// SettingsPanelView.swift — #settings-panel
// Preferences: hotkeys, gesture config, enrichment toggles, camera selection.

import SwiftUI

struct SettingsPanelView: View {
    @AppStorage("voiceMode") private var voiceMode: String = "pushToTalk"
    @AppStorage("gestureEnabled") private var gestureEnabled: Bool = true
    @AppStorage("gazeEnabled") private var gazeEnabled: Bool = true
    @AppStorage("enrichmentEnabled") private var enrichmentEnabled: Bool = true
    @AppStorage("detectionFPS") private var detectionFPS: Double = 15
    @AppStorage("dwellDuration") private var dwellDuration: Double = 0.5
    @AppStorage("pollingInterval") private var pollingInterval: Double = 2.0

    var body: some View {
        TabView {
            generalTab
                .tabItem { Label("General", systemImage: "gear") }
            inputTab
                .tabItem { Label("Input", systemImage: "hand.raised") }
            enrichmentTab
                .tabItem { Label("Context", systemImage: "text.badge.plus") }
        }
        .frame(width: 450, height: 350)
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
}
