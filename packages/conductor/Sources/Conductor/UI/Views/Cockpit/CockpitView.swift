// CockpitView.swift — #cockpit-view
// THE BRIDGE — the full-screen fleet cockpit. A 3-zone shell:
//
//   [ FleetSpineView ] | [ center: active session's ATRIUM (CHORUS stays inside) ]
//
// Governing rule (Mika): you never travel — the room reconfigures. Switching
// sessions is a 120ms CROSS-FADE in place, not a slide. The CHORUS rail STAYS
// INSIDE the center (AtriumThreadView already hosts the push-out rail) — the
// cockpit does NOT lift it to a separate zone.
//
// The `.id(active.id)` on the center is LOAD-BEARING: it gives SwiftUI a clean
// per-session view identity so switching sessions tears down the previous
// session's scroll/pin/drill UI state instead of leaking it across (each session
// keeps its OWN conversation running in the background regardless — the session
// objects are never recreated, only the VIEW identity rotates).

import SwiftUI

struct CockpitView: View {
    @ObservedObject var store: FleetStore
    @ObservedObject var projectStore: ProjectStore

    /// Whether the spawn sheet is presented (#session-spawn-sheet).
    @State private var showingSpawn = false

    var body: some View {
        HSplitView {
            FleetSpineView(
                store: store,
                onNewSession: { showingSpawn = true }
            )
            .frame(minWidth: 240, idealWidth: 280, maxWidth: 340)

            center
                .frame(minWidth: 480, maxWidth: .infinity, maxHeight: .infinity)
                // 120ms CROSS-FADE in place on session switch / empty↔active.
                .animation(.easeInOut(duration: 0.12), value: store.activeSessionId)
        }
        .background(AtriumTheme.void)
        .sheet(isPresented: $showingSpawn) {
            SessionSpawnSheet(
                store: store,
                projectStore: projectStore,
                isPresented: $showingSpawn
            )
        }
        // ⌘1–9 select by index, ⌘↑/⌘↓ step, ⌘N opens the spawn sheet. Menu key
        // equivalents (ConductorApp) handle ⌘⇧A to open the cockpit window itself;
        // these are the in-cockpit fleet controls.
        .background(fleetKeyboardShortcuts)
    }

    // MARK: - Center zone

    @ViewBuilder
    private var center: some View {
        if let active = store.active {
            // .id(active.id) is LOAD-BEARING — clean per-session UI state on switch.
            // The CHORUS rail is hosted INSIDE AtriumThreadView (push-out), so it
            // travels with the active session here; we do NOT fork the thread view.
            AtriumThreadView(session: active)
                .id(active.id)
                // 120ms cross-fade IN PLACE — "the room reconfigures", no slide.
                .transition(.opacity)
        } else {
            FleetEmptyState(onStart: { showingSpawn = true })
                .transition(.opacity)
        }
    }

    // MARK: - In-cockpit fleet keyboard shortcuts (⌘1–9 / ⌘↑↓ / ⌘N)

    /// Invisible buttons carrying the fleet keyboard shortcuts. Placed in a
    /// background so they participate in the key-equivalent chain without occupying
    /// layout. ⌘1–9 jump to a session by insertion index; ⌘↑/⌘↓ step; ⌘N spawns.
    private var fleetKeyboardShortcuts: some View {
        ZStack {
            ForEach(1...9, id: \.self) { n in
                Button("") { store.setActive(index: n - 1) }
                    .keyboardShortcut(KeyEquivalent(Character("\(n)")), modifiers: .command)
            }
            Button("") { store.moveActive(by: -1) }
                .keyboardShortcut(.upArrow, modifiers: .command)
            Button("") { store.moveActive(by: 1) }
                .keyboardShortcut(.downArrow, modifiers: .command)
            Button("") { showingSpawn = true }
                .keyboardShortcut("n", modifiers: .command)
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }
}

// MARK: - Empty / first-run (calm void)

/// The first-run / all-closed state: a calm void with the bridge invitation and a
/// single AMBER-bordered "Start a session" CTA — the ONE sanctioned non-attention
/// amber (Mika: the first-run primary action). No animation; the void is still.
struct FleetEmptyState: View {
    let onStart: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "sailboat")
                .font(.system(size: 34, weight: .ultraLight))
                .foregroundColor(AtriumTheme.inkMuted)
            Text("This is the bridge.")
                .font(.system(size: 19, weight: .semibold, design: .monospaced))
                .foregroundColor(AtriumTheme.ink)
            Text("Spawn a session and it appears in the spine on the left.\nA fleet of working sessions stays calm; the spine pages you only when you're needed.")
                .font(AtriumTheme.bodyFont)
                .foregroundColor(AtriumTheme.inkMuted)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .frame(maxWidth: 460)

            Button(action: onStart) {
                Text("Start a session")
                    .font(AtriumTheme.chipFont)
                    .foregroundColor(AtriumTheme.amber)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 9)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(AtriumTheme.amber, lineWidth: 1.5)
                    )
            }
            .buttonStyle(.plain)
            .padding(.top, 6)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AtriumTheme.void)
    }
}
