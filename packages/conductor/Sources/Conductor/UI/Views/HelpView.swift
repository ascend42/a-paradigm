// HelpView.swift — #help-view
// In-app documentation for Conductor capabilities, menus, and workflow.
// Accessible via the ? button in the header bar.

import SwiftUI

struct HelpView: View {
    @Binding var isPresented: Bool

    @State private var selectedSection: HelpSection = .overview

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "questionmark.circle.fill")
                    .foregroundStyle(.blue)
                Text("Conductor Guide")
                    .font(.headline)
                Spacer()
                Button(action: { isPresented = false }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
            }
            .padding()

            Divider()

            // Content
            HStack(spacing: 0) {
                // Section list
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(HelpSection.allCases, id: \.self) { section in
                            Button(action: { selectedSection = section }) {
                                HStack(spacing: 8) {
                                    Image(systemName: section.icon)
                                        .frame(width: 16)
                                        .foregroundStyle(selectedSection == section ? .blue : .secondary)
                                    Text(section.title)
                                        .font(.caption)
                                        .foregroundStyle(selectedSection == section ? .primary : .secondary)
                                    Spacer()
                                }
                                .padding(.horizontal, 8)
                                .padding(.vertical, 5)
                                .background(
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(selectedSection == section ? Color.blue.opacity(0.1) : Color.clear)
                                )
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                    .padding(8)
                }
                .frame(width: 160)
                .background(Color(nsColor: .controlBackgroundColor))

                Divider()

                // Detail content
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        sectionContent(selectedSection)
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(width: 620, height: 500)
    }

    // MARK: - Section Content

    @ViewBuilder
    private func sectionContent(_ section: HelpSection) -> some View {
        switch section {
        case .overview:
            overviewContent
        case .sessions:
            sessionsContent
        case .workspace:
            workspaceContent
        case .linking:
            linkingContent
        case .symphony:
            symphonyContent
        case .sentinel:
            sentinelContent
        case .input:
            inputContent
        case .shortcuts:
            shortcutsContent
        case .rough:
            roughContent
        }
    }

    // MARK: - Overview

    private var overviewContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("What is Conductor?")
            bodyText("Conductor is your multimodal mission control for Claude Code sessions. It detects running sessions, lets you manage projects, spawn new instances, link them for collaboration, and monitor activity — all from a persistent macOS overlay.")

            sectionTitle("Getting Started")
            bulletList([
                "Launch with `paradigm conductor` from any directory",
                "Grant Accessibility permission when prompted (required for window management)",
                "Your projects appear automatically from Paradigm session history",
                "Click Resume to pick up where you left off, or Open for a fresh session",
            ])

            sectionTitle("Key Concepts")
            keyValue("Sessions", "Active Claude Code terminal windows that Conductor can detect and manage")
            keyValue("Projects", "Directories you've worked in — auto-discovered from ~/.paradigm/sessions/")
            keyValue("Linking", "Grouping 2+ instances so they can collaborate via Symphony messaging")
            keyValue("Workspace", "The grid layout of terminal windows managed by Conductor")
        }
    }

    // MARK: - Sessions

    private var sessionsContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Sessions Panel")
            bodyText("The Sessions section shows all your known projects with their last checkpoint status. Projects are auto-discovered from your Paradigm session history.")

            sectionTitle("Project Cards")
            bulletList([
                "Name, pin status, and checkpoint phase badge (Planning/Implementing/Complete)",
                "Context summary — what was happening when you last worked",
                "File count and age of the checkpoint",
            ])

            sectionTitle("Actions")
            keyValue("Resume", "Opens Terminal.app in the project directory. Claude auto-recovers your session context via paradigm_session_recover.")
            keyValue("Open", "Same as Resume, but for projects without a checkpoint — starts fresh.")
            keyValue("Headless", "Spawns a background Claude process (no terminal window). Useful for automated tasks.")
            keyValue("Discard", "Removes the checkpoint so the next session starts clean.")
            keyValue("Pin/Unpin", "Pin projects to keep them at the top of the list.")

            sectionTitle("Launch Sheet (+)")
            bodyText("Click the + button to launch a new agent at any path with a specific role (architect, builder, reviewer, tester).")
        }
    }

    // MARK: - Workspace

    private var workspaceContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Workspace Grid")
            bodyText("Conductor arranges your terminal windows in a grid layout. The sidebar sits on one side, and terminal cells fill the remaining space.")

            sectionTitle("Grid Layouts")
            bulletList([
                "1x1 — Single focused terminal",
                "1x2 — Two terminals side by side",
                "2x2 — Four terminals in a grid",
                "3x2 — Six terminals (3 columns, 2 rows)",
            ])

            sectionTitle("Window Management")
            bulletList([
                "Conductor detects Claude Code terminals via Accessibility API",
                "Sessions registered with /conduct are detected near-instantly",
                "Auto-arrange positions windows according to the grid layout",
                "Sidebar width is adjustable and persisted",
            ])
        }
    }

    // MARK: - Linking

    private var linkingContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Instance Linking")
            bodyText("Link 2+ running instances together to create a collaboration group. Linked instances can exchange messages via Paradigm Symphony.")

            sectionTitle("How to Link")
            bulletList([
                "Click the link icon (chain) in the Sessions header",
                "Tap project cards to select them (blue highlight = selected)",
                "Click Link when 2+ are selected — creates a group",
                "Click Cancel to exit linking mode without creating a group",
            ])

            sectionTitle("What Linking Does")
            bulletList([
                "Creates an Agent Group in ~/.paradigm/conductor/groups.json",
                "Each instance gets a Symphony agent ID for messaging",
                "Groups persist across Conductor restarts",
                "Linked instances can send/receive Symphony notes",
            ])

            noteBox("For real-time message passing, each Claude session should run /conduct to register with Conductor. Linking creates the group structure — registration enables live communication.")
        }
    }

    // MARK: - Symphony

    private var symphonyContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Symphony Integration")
            bodyText("Symphony is Paradigm's inter-agent messaging system. Conductor acts as a relay and viewer for Symphony threads between linked instances.")

            sectionTitle("Thread View")
            bulletList([
                "Shows active conversation threads between agents",
                "Messages appear with agent attribution (role + project)",
                "You can compose messages as the human orchestrator (Maestro)",
            ])

            sectionTitle("File Approvals")
            bulletList([
                "Agents can request file access via Symphony",
                "Conductor shows approval banners with SHA-256 verification",
                "Hard-deny patterns protect sensitive files (.env, *.key)",
                "Trust config determines auto-approve vs manual review",
            ])
        }
    }

    // MARK: - Sentinel

    private var sentinelContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Sentinel Live View")
            bodyText("Real-time event stream from your running applications. Connects via WebSocket to localhost:3838 when a Sentinel instance is running.")

            sectionTitle("Features")
            bulletList([
                "200-event rolling buffer with level + symbol filtering",
                "Click events to see detail popovers",
                "Active symbols panel shows frequency-sorted, clickable symbols",
                "Filter by symbol type (#component, ^gate, !signal, etc.)",
            ])
        }
    }

    // MARK: - Input

    private var inputContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Multimodal Input")
            bodyText("Conductor supports multiple input modalities beyond keyboard. These require Camera and Microphone permissions.")

            sectionTitle("Voice (Whisper)")
            bodyText("Push-to-talk speech recognition via CoreML WhisperKit. Transcribed text goes to the buffer for editing before dispatch.")

            sectionTitle("Gesture Recognition")
            bulletList([
                "Hand pose detection at 15fps via Apple Vision",
                "Recognized gestures: swipe, pinch, fist, open palm, two-finger tap",
                "Customizable gesture-to-action bindings",
            ])

            sectionTitle("Gaze Tracking")
            bulletList([
                "Eye tracking via face landmark detection",
                "Kalman-filtered for smooth targeting",
                "500ms dwell trigger to select a target window",
                "5-point calibration for screen-space mapping",
            ])

            noteBox("Voice and gaze features are experimental. Gaze calibration UI is still in development. These features work best with good lighting and a stable camera position.")
        }
    }

    // MARK: - Shortcuts

    private var shortcutsContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Keyboard Shortcuts")

            shortcutRow("Cmd+1–6", "Switch workspace layout presets")
            shortcutRow("Cmd+Return", "Send buffer content to targeted instance")
            shortcutRow("Cmd+Q", "Quit Conductor")
            shortcutRow("Cmd+,", "Open settings")

            sectionTitle("Bindings")
            bodyText("Custom bindings can be configured for gestures, voice commands, hotkeys, and eyebrow triggers in the Bindings Manager (Settings > Bindings).")
        }
    }

    // MARK: - What's Rough

    private var roughContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Known Limitations")
            bodyText("Conductor is under active development. Here's what's still rough:")

            roughItem(
                "Terminal auto-registration",
                "Sessions launched via Resume/Open need to run /conduct for Conductor to see them as live instances. AX detection works but is slower (2s poll)."
            )
            roughItem(
                "Binary updates",
                "After rebuilding from the monorepo, run `paradigm conductor --install` again to update the global binary. No auto-update yet."
            )
            roughItem(
                "Linking requires registration",
                "Creating a group sets up the structure, but real-time Symphony messaging requires both sessions to have registered agent parts via /conduct."
            )
            roughItem(
                "Voice input",
                "WhisperKit is included but the transcription pipeline is not fully wired. Push-to-talk hotkey is configured but may not produce output."
            )
            roughItem(
                "Gaze calibration",
                "The 5-point calibration UI overlay is stubbed. Currently uses a simple linear mapping which works but isn't precise."
            )
            roughItem(
                "Window detection",
                "Only detects terminal windows with 'claude' in the title. Other terminals or renamed windows may not be found."
            )

            sectionTitle("Reporting Issues")
            bodyText("File issues at github.com/ascend42/a-paradigm/issues or discuss in your current Claude session.")
        }
    }

    // MARK: - UI Components

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 14, weight: .semibold))
            .padding(.top, 4)
    }

    private func bodyText(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func bulletList(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(items, id: \.self) { item in
                HStack(alignment: .top, spacing: 6) {
                    Text("\u{2022}")
                        .font(.system(size: 12))
                        .foregroundStyle(.tertiary)
                    Text(item)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func keyValue(_ key: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(key)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(.blue)
                .frame(width: 80, alignment: .trailing)
            Text(value)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func shortcutRow(_ shortcut: String, _ description: String) -> some View {
        HStack(spacing: 12) {
            Text(shortcut)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 3).fill(Color(nsColor: .controlBackgroundColor)))
            Text(description)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            Spacer()
        }
    }

    private func noteBox(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "info.circle.fill")
                .foregroundStyle(.blue)
                .font(.system(size: 12))
            Text(text)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.blue.opacity(0.06)))
    }

    private func roughItem(_ title: String, _ description: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Image(systemName: "wrench.and.screwdriver")
                    .font(.system(size: 10))
                    .foregroundStyle(.orange)
                Text(title)
                    .font(.system(size: 12, weight: .medium))
            }
            Text(description)
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 18)
        }
    }
}

// MARK: - Help Sections

enum HelpSection: String, CaseIterable {
    case overview
    case sessions
    case workspace
    case linking
    case symphony
    case sentinel
    case input
    case shortcuts
    case rough

    var title: String {
        switch self {
        case .overview: return "Overview"
        case .sessions: return "Sessions"
        case .workspace: return "Workspace"
        case .linking: return "Linking"
        case .symphony: return "Symphony"
        case .sentinel: return "Sentinel"
        case .input: return "Input"
        case .shortcuts: return "Shortcuts"
        case .rough: return "What's Rough"
        }
    }

    var icon: String {
        switch self {
        case .overview: return "house"
        case .sessions: return "bolt.fill"
        case .workspace: return "square.grid.2x2"
        case .linking: return "link"
        case .symphony: return "music.note.list"
        case .sentinel: return "shield"
        case .input: return "hand.raised"
        case .shortcuts: return "keyboard"
        case .rough: return "wrench.and.screwdriver"
        }
    }
}
