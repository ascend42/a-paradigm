// Input choice of #gnomon-voice-io (founder request 2026-10-23: "a clear input selection inside gnomon"). Pure, so
// `swift test` covers it. The human picks an input by CoreAudio device UID, or follows the system default (nil). The
// choice is kept when the device disconnects: the mic then follows the system default and reports `missing`, and
// the chosen device is used again as soon as it reconnects.

public struct InputResolution: Equatable {
    /// the UID to capture from (nil: no input device at all)
    public let uid: String?
    /// a device was chosen but is not connected now (the mic follows the system default meanwhile)
    public let missing: Bool
    public init(uid: String?, missing: Bool) {
        self.uid = uid
        self.missing = missing
    }
}

public enum InputChoice {
    public static let maxUIDLength = 256

    public static func wellFormedUID(_ u: String) -> Bool {
        !u.isEmpty && u.count <= maxUIDLength && u.unicodeScalars.allSatisfy { $0.value >= 0x20 && $0.value != 0x7F }
    }

    /// The device to use: the chosen one when it is connected, else the system default (marked missing when a chosen
    /// one is absent), else the first available input.
    public static func resolve(preferred: String?, available: [String], systemDefault: String?) -> InputResolution {
        if let p = preferred, available.contains(p) { return InputResolution(uid: p, missing: false) }
        let missing = preferred != nil
        if let d = systemDefault, available.contains(d) { return InputResolution(uid: d, missing: missing) }
        return InputResolution(uid: available.first, missing: missing)
    }
}
