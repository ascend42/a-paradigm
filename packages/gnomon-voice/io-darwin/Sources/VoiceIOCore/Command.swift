// Command parser of gnomon-voice-io:v1 (#gnomon-voice-io). A command is a JSON
// frame on stdin: {"op": "...", "id"?: int|string, ...}. Every command gets
// exactly one reply {"type":"reply","id","op","ok":true,...} or
// {"type":"reply","id","op","ok":false,"error":"<code>","message"}.
//
//   info                         version, protocol, pid, mic, aec, route, hotkeys, formats
//   mic.on / mic.off             start / stop the input (mic.off stops the engine: no orange dot)
//   play.stop                    barge-in: drop every queued TTS sample now
//   play.end                     the current utterance is complete: flush the resampler tail
//   route.get                    the current output route and aec mode
//   hotkeys.set {bindings}       partial update, e.g. {"talk":"ctrl+alt+space","mode-toggle":"none"}
//   inputs.list                  the input devices, the chosen one (or null: the system default), the one in use
//   input.select {device: uid|null} choose the input by CoreAudio device UID (null: follow the system default); remembered
//                                while the process runs, also when the device is gone (it is used again when it returns)
//   quit                         reply, then exit 0 (stdin EOF does the same)

import Foundation

public enum Command: Equatable {
    case info
    case micOn
    case micOff
    case playStop
    case playEnd
    case routeGet
    case hotkeysSet([String: String], allowBare: Bool)
    case inputsList
    case inputSelect(String?)
    case quit

    public var op: String {
        switch self {
        case .info: return "info"
        case .micOn: return "mic.on"
        case .micOff: return "mic.off"
        case .playStop: return "play.stop"
        case .playEnd: return "play.end"
        case .routeGet: return "route.get"
        case .hotkeysSet: return "hotkeys.set"
        case .inputsList: return "inputs.list"
        case .inputSelect: return "input.select"
        case .quit: return "quit"
        }
    }
}

/// The request id, echoed verbatim in the reply.
public enum RequestId: Equatable {
    case none
    case int(Int)
    case string(String)

    public var json: Any {
        switch self {
        case .none: return NSNull()
        case .int(let i): return i
        case .string(let s): return s
        }
    }
}

public struct CommandError: Error, Equatable {
    public let code: String
    public let message: String
    public let id: RequestId
    public let op: String?

    public init(code: String, message: String, id: RequestId, op: String?) {
        self.code = code
        self.message = message
        self.id = id
        self.op = op
    }
}

public enum CommandParser {
    public static let maxIdLength = 128

    public static func parse(_ payload: Data) throws -> (id: RequestId, command: Command) {
        guard let any = try? JSONSerialization.jsonObject(with: payload), let obj = any as? [String: Any] else {
            throw CommandError(code: "bad-json", message: "a command is one JSON object", id: .none, op: nil)
        }
        let id: RequestId
        switch obj["id"] {
        case nil, is NSNull: id = .none
        case let n as NSNumber where CFGetTypeID(n) != CFBooleanGetTypeID() && n.doubleValue == Double(n.intValue): id = .int(n.intValue)
        case let s as String where s.count <= maxIdLength: id = .string(s)
        default: throw CommandError(code: "bad-request", message: "id must be an integer or a short string", id: .none, op: nil)
        }
        guard let op = obj["op"] as? String else {
            throw CommandError(code: "bad-request", message: "op is required", id: id, op: nil)
        }
        func bad(_ m: String) -> CommandError { CommandError(code: "bad-request", message: m, id: id, op: op) }
        switch op {
        case "info": return (id, .info)
        case "mic.on": return (id, .micOn)
        case "mic.off": return (id, .micOff)
        case "play.stop": return (id, .playStop)
        case "play.end": return (id, .playEnd)
        case "route.get": return (id, .routeGet)
        case "quit": return (id, .quit)
        case "inputs.list": return (id, .inputsList)
        case "input.select":
            switch obj["device"] {
            case nil, is NSNull: return (id, .inputSelect(nil))
            case let u as String where InputChoice.wellFormedUID(u): return (id, .inputSelect(u))
            default: throw bad("device is a device UID (1-256 printable characters) or null")
            }
        case "hotkeys.set":
            guard let raw = obj["bindings"] as? [String: Any], !raw.isEmpty else { throw bad("bindings must be a non-empty object") }
            var out: [String: String] = [:]
            for (k, v) in raw {
                guard let s = v as? String else { throw bad("binding \(k) must be a string") }
                out[k] = s
            }
            // validate here so a bad config is refused before anything is unregistered
            if let ab = obj["allowBare"], !(ab is Bool) { throw bad("allowBare must be a boolean") }
            let allowBare = (obj["allowBare"] as? Bool) ?? false
            do { _ = try HotkeyConfig.defaults.applying(out, allowBare: allowBare) } catch let e as HotkeyError {
                // a duplicate against the defaults may be fine against the live config; only syntax is checked here
                if case .duplicate = e {} else { throw bad(e.description) }
            }
            return (id, .hotkeysSet(out, allowBare: allowBare))
        default:
            throw CommandError(code: "unknown-op", message: "unknown op \(op)", id: id, op: op)
        }
    }

    public static func reply(id: RequestId, op: String, fields: [String: Any] = [:]) -> [String: Any] {
        var r = fields
        r["type"] = "reply"
        r["id"] = id.json
        r["op"] = op
        r["ok"] = true
        return r
    }

    public static func errorReply(_ e: CommandError) -> [String: Any] {
        ["type": "reply", "id": e.id.json, "op": e.op ?? NSNull(), "ok": false, "error": e.code, "message": e.message]
    }
}
