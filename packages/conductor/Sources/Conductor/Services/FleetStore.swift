// FleetStore.swift — #fleet-store
// THE BRIDGE's session fleet — composition over shared state. Holds N fully
// isolated ClaudeStreamSessions (each owns its own Process/Pipes/off-main
// LineFramer/SessionTranscript and all @Published state) and tracks which one the
// founder is currently looking at. Background (non-active) sessions keep streaming
// into their OWN state because ingest is instance-bound — the FleetStore never
// reaches into a session's stream machinery (~session-isolation).
//
// $fleet-spawn: spawn(projectPath:initialPrompt:) constructs a session, starts it,
//   appends it (insertion-ordered), and makes it active.
// $fleet-switch: setActive(id:) just changes which session the center renders;
//   every other session keeps running untouched in the background.

import Foundation

/// The single owner of the live session fleet for THE BRIDGE (#fleet-store).
/// Injected into ConductorCockpitWindow by AppDelegate (the window does not own it).
@MainActor
final class FleetStore: ObservableObject {

    /// All live sessions, INSERTION-ORDERED (newest spawned at the end). The spine
    /// groups these by derived status for display, but this list preserves spawn
    /// order so ⌘1–9 indexing is stable.
    @Published private(set) var sessions: [ClaudeStreamSession] = []

    /// The session the cockpit center is currently rendering. nil → empty state.
    @Published var activeSessionId: UUID?

    /// Soft cap: the fleet is comfortable up to `softCap` sessions; the spine warns
    /// past `warnAt`. Not a hard block — the founder may push past, the UI just
    /// surfaces the strain (density tiers in FleetSpineView).
    static let softCap = 6
    static let warnAt = 4

    /// The currently active session, if any.
    var active: ClaudeStreamSession? {
        guard let id = activeSessionId else { return nil }
        return sessions.first { $0.id == id }
    }

    /// True when the fleet is at/over the soft cap — spawn is discouraged.
    var atSoftCap: Bool { sessions.count >= Self.softCap }

    /// True when the fleet is past the comfortable band — the spine warns.
    var shouldWarnCount: Bool { sessions.count > Self.warnAt }

    // MARK: - $fleet-spawn

    /// Spawn a new session in `projectPath`, optionally seeding the first turn.
    /// Returns the new session's id, or nil if the soft cap blocked it (caller may
    /// override by passing force=true once the founder confirms past-cap spawn).
    @discardableResult
    func spawn(projectPath: String, initialPrompt: String?, force: Bool = false) -> UUID? {
        if atSoftCap && !force {
            ConductorLog.flow("fleet-spawn")
                .error("spawn blocked — fleet at soft cap (\(self.sessions.count)/\(Self.softCap)); pass force=true to override")
            return nil
        }
        let session = ClaudeStreamSession(projectPath: projectPath)
        session.start(initialPrompt: initialPrompt)
        sessions.append(session)
        activeSessionId = session.id
        ConductorLog.flow("fleet-spawn")
            .info("spawned session \(session.id) @ \(projectPath) (fleet now \(self.sessions.count)); active")
        return session.id
    }

    // MARK: - $fleet-switch

    /// Make `id` the active (rendered) session. Every other session keeps running
    /// untouched in the background — this only changes what the center shows. A
    /// no-op if `id` isn't in the fleet.
    func setActive(_ id: UUID) {
        guard sessions.contains(where: { $0.id == id }) else {
            ConductorLog.flow("fleet-switch")
                .error("setActive(\(id)) — no such session in fleet")
            return
        }
        activeSessionId = id
        ConductorLog.flow("fleet-switch")
            .info("active session → \(id)")
    }

    /// Select by insertion index (0-based) — backs ⌘1–9. No-op if out of range.
    func setActive(index: Int) {
        guard sessions.indices.contains(index) else { return }
        setActive(sessions[index].id)
    }

    /// Move the active selection by `delta` through insertion order (⌘↑ / ⌘↓),
    /// clamped to the ends. No wrap — the fleet is small and "off the end" is noise.
    func moveActive(by delta: Int) {
        guard !sessions.isEmpty else { return }
        let currentIndex = activeSessionId.flatMap { id in
            sessions.firstIndex { $0.id == id }
        } ?? 0
        let next = max(0, min(sessions.count - 1, currentIndex + delta))
        setActive(sessions[next].id)
    }

    // MARK: - Close / teardown

    /// Close one session — shut its claude process down and remove it from the
    /// fleet. If it was active, fall back to the nearest remaining session (the one
    /// that took its slot, else the new last), or nil when the fleet empties.
    func close(_ id: UUID) {
        guard let idx = sessions.firstIndex(where: { $0.id == id }) else {
            ConductorLog.flow("fleet-switch")
                .error("close(\(id)) — no such session in fleet")
            return
        }
        let wasActive = activeSessionId == id
        sessions[idx].shutdown()
        sessions.remove(at: idx)

        if wasActive {
            if sessions.isEmpty {
                activeSessionId = nil
            } else {
                // Prefer the session that slid into the closed slot; else clamp.
                let fallback = sessions.indices.contains(idx) ? idx : sessions.count - 1
                activeSessionId = sessions[fallback].id
            }
        }
        ConductorLog.flow("fleet-switch")
            .info("closed session \(id) (fleet now \(self.sessions.count)); active=\(self.activeSessionId?.uuidString ?? "none")")
    }

    /// Shut every session down (window close / app terminate). Each session's own
    /// shutdown() reaps its background shells + terminates its process.
    func shutdownAll() {
        ConductorLog.flow("fleet-switch")
            .info("shutdownAll — tearing down \(self.sessions.count) session(s)")
        for session in sessions { session.shutdown() }
        sessions.removeAll()
        activeSessionId = nil
    }

    // MARK: - Derived counts (spine bridge bar)

    /// How many sessions are currently AMBER (needs you). Drives the bridge bar
    /// "M needs you" count + amber. Computed against the live active id so the
    /// active session never counts itself as paging.
    var needsYouCount: Int {
        sessions.filter { $0.derivedStatus(isActiveSession: $0.id == activeSessionId) == .awaitingYou }.count
    }
}
