// SymphonySettingsView.swift — #symphony-settings
// Settings tab for Symphony configuration: auto-link, relay, voice approval.

import SwiftUI

struct SymphonySettingsView: View {
    @AppStorage("symphonyEnabled") private var symphonyEnabled: Bool = false
    @AppStorage("symphonyRelayInterval") private var relayInterval: Double = 5.0
    @AppStorage("symphonyVoiceApproval") private var voiceApprovalEnabled: Bool = true

    @ObservedObject var partManager: AgentPartManager
    @ObservedObject var relay: NoteRelay

    var body: some View {
        Form {
            Section("Auto-Link") {
                Toggle("Enable Symphony auto-linking", isOn: $symphonyEnabled)
                Text("Automatically detect Claude Code sessions and register them as agents in The Score.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Section("Note Relay") {
                HStack {
                    Text("Relay interval")
                    Spacer()
                    Slider(value: $relayInterval, in: 1...30, step: 1)
                        .frame(width: 150)
                    Text("\(Int(relayInterval))s")
                        .monospacedDigit()
                        .frame(width: 30)
                }

                HStack {
                    Text("Status")
                    Spacer()
                    Circle()
                        .fill(relay.isRelaying ? Color.green : Color.gray)
                        .frame(width: 8, height: 8)
                    Text(relay.isRelaying ? "Relaying" : "Stopped")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                LabeledContent("Notes relayed") {
                    Text("\(relay.relayedNoteCount)")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Voice Approval") {
                Toggle("Enable voice file approval", isOn: $voiceApprovalEnabled)
                Text("Say \"approve\" or \"deny\" to handle file requests by voice.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Section("Diagnostics") {
                LabeledContent("Registered agents") {
                    Text("\(partManager.registeredAgents.count)")
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Active threads") {
                    Text("\(relay.activeThreads.count)")
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Pending file requests") {
                    Text("\(relay.pendingFileRequests.count)")
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Score directory") {
                    Text("~/.paradigm/score/")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
