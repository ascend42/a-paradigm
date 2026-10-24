// Hotkey config of gnomon-voice-io:v1 (#gnomon-voice-io). Pure: key specs parse
// to Carbon virtual key codes and modifier masks (values copied from
// Carbon.HIToolbox so this target needs no Carbon import).
//
//   spec    = mod ("+" mod)* "+" key | "none"
//   mod     = ctrl|control  alt|opt|option  cmd|command  shift
//   key     = a-z | 0-9 | space | return | tab | escape | period (".") | grave ("`") | f1..f12
//
// At least one of ctrl/alt/cmd is required (F-keys excepted), so a binding can
// never swallow plain typing. TD-2026-10-21-514: a BARE grave is allowed only by
// explicit opt-in (hotkeys.set{allowBare:true}) and only for mic-toggle ("While
// Gnomon voice runs, ` will not type in any app."). send-now (Carbon id 6,
// default ctrl+alt+return) sends the composer draft: a hand origin. Actions: talk (hold: press and release), mic-toggle,
// mode-toggle (ambient vs push-to-talk), hold-toggle (dictation: hold the composer's
// countdown; TD-2026-10-20-262), stop-speaking (cut the reply being read aloud;
// T-2026-10-19-026). The binary only REPORTS hotkeys; the
// controller decides what they do (it sends mic.on / mic.off itself).

import Foundation

public enum HotkeyAction: String, CaseIterable, Sendable {
    case talk
    case micToggle = "mic-toggle"
    case modeToggle = "mode-toggle"
    case holdToggle = "hold-toggle"
    case stopSpeaking = "stop-speaking"
    case sendNow = "send-now"

    /// Carbon EventHotKeyID.id (1-based, stable).
    public var carbonId: UInt32 {
        switch self {
        case .talk: return 1
        case .micToggle: return 2
        case .modeToggle: return 3
        case .holdToggle: return 4
        case .stopSpeaking: return 5
        case .sendNow: return 6
        }
    }

    public init?(carbonId: UInt32) {
        guard let a = HotkeyAction.allCases.first(where: { $0.carbonId == carbonId }) else { return nil }
        self = a
    }
}

public struct HotkeySpec: Equatable, Hashable, Sendable {
    public static let cmdKey: UInt32 = 0x0100
    public static let shiftKey: UInt32 = 0x0200
    public static let optionKey: UInt32 = 0x0800
    public static let controlKey: UInt32 = 0x1000

    public let keyCode: UInt32
    public let modifiers: UInt32
    public let key: String

    public init(keyCode: UInt32, modifiers: UInt32, key: String) {
        self.keyCode = keyCode
        self.modifiers = modifiers
        self.key = key
    }

    static let keyCodes: [String: UInt32] = {
        var m: [String: UInt32] = [
            "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07,
            "c": 0x08, "v": 0x09, "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10,
            "t": 0x11, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17, "9": 0x19,
            "7": 0x1A, "8": 0x1C, "0": 0x1D, "o": 0x1F, "u": 0x20, "i": 0x22, "p": 0x23, "l": 0x25,
            "j": 0x26, "k": 0x28, "n": 0x2D, "m": 0x2E,
            "space": 0x31, "return": 0x24, "tab": 0x30, "escape": 0x35, ".": 0x2F, // kVK_ANSI_Period ("period" parses to ".")
            "`": 0x32, // kVK_ANSI_Grave ("grave" / "backtick" parse to "`")
        ]
        let f: [UInt32] = [0x7A, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6D, 0x67, 0x6F]
        for (i, code) in f.enumerated() { m["f\(i + 1)"] = code }
        return m
    }()

    static let modifierNames: [String: UInt32] = [
        "ctrl": controlKey, "control": controlKey,
        "alt": optionKey, "opt": optionKey, "option": optionKey,
        "cmd": cmdKey, "command": cmdKey,
        "shift": shiftKey,
    ]

    /// Parses "ctrl+alt+space". Returns nil for "none" (binding disabled). allowBare admits a bare grave (opt-in).
    public static func parse(_ raw: String, allowBare: Bool = false) throws -> HotkeySpec? {
        let s = raw.trimmingCharacters(in: .whitespaces).lowercased()
        if s == "none" { return nil }
        let parts = s.split(separator: "+", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count >= 1, parts.allSatisfy({ !$0.isEmpty }), var keyName = parts.last else { throw HotkeyError.badSpec(raw) }
        if keyName == "period" { keyName = "." }
        if keyName == "grave" || keyName == "backtick" { keyName = "`" }
        guard let code = keyCodes[keyName] else { throw HotkeyError.unknownKey(keyName) }
        var mods: UInt32 = 0
        for m in parts.dropLast() {
            guard let bit = modifierNames[m] else { throw HotkeyError.unknownModifier(m) }
            if mods & bit != 0 { throw HotkeyError.badSpec(raw) }
            mods |= bit
        }
        let isFKey = keyName.hasPrefix("f") && keyName.count > 1
        let bareOk = isFKey || (allowBare && keyName == "`" && mods == 0)
        if !bareOk && mods & (controlKey | optionKey | cmdKey) == 0 { throw HotkeyError.needsModifier(raw) }
        return HotkeySpec(keyCode: code, modifiers: mods, key: keyName)
    }

    /// Canonical form: modifiers in a fixed order (ctrl, alt, shift, cmd), then the key.
    public var canonical: String {
        var p: [String] = []
        if modifiers & HotkeySpec.controlKey != 0 { p.append("ctrl") }
        if modifiers & HotkeySpec.optionKey != 0 { p.append("alt") }
        if modifiers & HotkeySpec.shiftKey != 0 { p.append("shift") }
        if modifiers & HotkeySpec.cmdKey != 0 { p.append("cmd") }
        p.append(key)
        return p.joined(separator: "+")
    }
}

public enum HotkeyError: Error, Equatable, CustomStringConvertible {
    case badSpec(String)
    case unknownKey(String)
    case unknownModifier(String)
    case needsModifier(String)
    case unknownAction(String)
    case duplicate(String)

    public var description: String {
        switch self {
        case .badSpec(let s): return "bad hotkey spec \"\(s)\""
        case .unknownKey(let s): return "unknown key \"\(s)\""
        case .unknownModifier(let s): return "unknown modifier \"\(s)\""
        case .needsModifier(let s): return "\"\(s)\" needs ctrl, alt or cmd"
        case .unknownAction(let s): return "unknown hotkey action \"\(s)\""
        case .duplicate(let s): return "\"\(s)\" is bound to two actions"
        }
    }
}

public struct HotkeyConfig: Equatable, Sendable {
    public private(set) var bindings: [HotkeyAction: HotkeySpec]

    public static let defaults: HotkeyConfig = {
        // force-unwrapped literals: covered by the defaults test
        var b: [HotkeyAction: HotkeySpec] = [:]
        b[.talk] = try! HotkeySpec.parse("ctrl+alt+space")!
        b[.micToggle] = try! HotkeySpec.parse("ctrl+`")! // TD-2026-10-21-514: ⌃` global
        b[.modeToggle] = try! HotkeySpec.parse("ctrl+alt+a")!
        b[.holdToggle] = try! HotkeySpec.parse("ctrl+alt+h")!
        b[.stopSpeaking] = try! HotkeySpec.parse("ctrl+alt+.")!
        b[.sendNow] = try! HotkeySpec.parse("ctrl+alt+return")!
        return HotkeyConfig(bindings: b)
    }()

    public init(bindings: [HotkeyAction: HotkeySpec]) {
        self.bindings = bindings
    }

    /// A partial update: each named action takes its new spec ("none" unbinds);
    /// unnamed actions keep theirs. The result must not bind one chord twice. allowBare (opt-in) admits a bare
    /// grave for mic-toggle only; every other action keeps the modifier rule.
    public func applying(_ update: [String: String], allowBare: Bool = false) throws -> HotkeyConfig {
        var b = bindings
        for (name, raw) in update {
            guard let action = HotkeyAction(rawValue: name) else { throw HotkeyError.unknownAction(name) }
            b[action] = try HotkeySpec.parse(raw, allowBare: allowBare && action == .micToggle)
        }
        var seen: [HotkeySpec: HotkeyAction] = [:]
        for action in HotkeyAction.allCases {
            guard let spec = b[action] else { continue }
            if seen[spec] != nil { throw HotkeyError.duplicate(spec.canonical) }
            seen[spec] = action
        }
        return HotkeyConfig(bindings: b)
    }

    /// {"talk": "ctrl+alt+space", "mic-toggle": "none", …} for replies and events.
    public var json: [String: String] {
        var out: [String: String] = [:]
        for a in HotkeyAction.allCases { out[a.rawValue] = bindings[a]?.canonical ?? "none" }
        return out
    }
}
