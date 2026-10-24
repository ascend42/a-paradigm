// Engine recovery policy of #gnomon-voice-io (founder field bug 2026-10-23). Pure, so `swift test` covers it.
//
// AVAudioEngine stops ITSELF when the I/O unit's format changes under it. With voice processing on a
// Bluetooth headset that happens on every mic start: the headset leaves its music profile for its call
// profile (AirPods Pro: 48 kHz → 24 kHz) a moment after the engine starts. The audio core used to answer
// by tearing the engine down and building a new one; the teardown turned voice processing off, which
// handed the headset back to its music profile, so the new engine switched it again and stopped again.
// The mic indicator flickered about once a second and no audio ever reached turn detection.
//
// The audio core now recovers IN PLACE (same engine, voice processing kept, the capture tap re-armed for
// the new format) after the device settles, and asks this governor first: past `limit` recoveries inside
// `windowNs` the device is still changing under us, so the mic turns off and the failure is reported
// (engine{what: "failed", reason: "restart-loop"}) instead of looping silently.

public struct RestartGovernor: Equatable {
    /// at most this many in-place recoveries …
    public static let defaultLimit = 3
    /// … inside this window
    public static let defaultWindowNs: UInt64 = 15_000_000_000
    /// how long a configuration change settles before the recovery runs (later notices restart the wait)
    public static let settleMs = 400

    public let limit: Int
    public let windowNs: UInt64
    public private(set) var recent: [UInt64] = []

    public init(limit: Int = RestartGovernor.defaultLimit, windowNs: UInt64 = RestartGovernor.defaultWindowNs) {
        self.limit = max(0, limit)
        self.windowNs = windowNs
    }

    /// A configuration change stopped the engine at `nowNs` (monotonic): may it recover? Records the
    /// recovery when allowed; false once `limit` recoveries already happened inside the window.
    public mutating func allow(nowNs: UInt64) -> Bool {
        recent.removeAll { nowNs >= $0 && nowNs - $0 >= windowNs }
        guard recent.count < limit else { return false }
        recent.append(nowNs)
        return true
    }

    /// A fresh mic.on starts a new budget.
    public mutating func reset() { recent.removeAll() }
}
