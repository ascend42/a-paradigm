// JSONValue.swift — #stream-event
// Recursive, fully-decodable JSON value used to absorb arbitrary tool_use input
// and heterogeneous tool_result content from the claude stream-json protocol.
// Never throws on shape — anything decodes into one of these cases.

import Foundation

/// A recursive JSON value capable of decoding any well-formed JSON.
/// Used where the wire shape is arbitrary (tool inputs, tool results).
indirect enum JSONValue: Decodable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
            return
        }
        if let b = try? container.decode(Bool.self) {
            self = .bool(b)
            return
        }
        if let n = try? container.decode(Double.self) {
            self = .number(n)
            return
        }
        if let s = try? container.decode(String.self) {
            self = .string(s)
            return
        }
        if let arr = try? container.decode([JSONValue].self) {
            self = .array(arr)
            return
        }
        if let obj = try? container.decode([String: JSONValue].self) {
            self = .object(obj)
            return
        }
        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Unrecognized JSON value"
        )
    }

    // MARK: - Display helpers

    /// Flatten this value to a one-line human-readable string.
    /// - string → the string
    /// - number/bool → its description
    /// - null → ""
    /// - array of `{type:"text", text:"..."}` → the texts joined (tool_result shape)
    /// - other arrays → elements joined with " "
    /// - object → `key=value` pairs joined with " "
    var asDisplayString: String {
        switch self {
        case .string(let s):
            return s
        case .number(let n):
            // Render integers without a trailing ".0"
            if n.rounded() == n, abs(n) < 1e15 {
                return String(Int(n))
            }
            return String(n)
        case .bool(let b):
            return b ? "true" : "false"
        case .null:
            return ""
        case .array(let arr):
            // tool_result content arrays are typically [{type:"text", text:"..."}]
            let textParts: [String] = arr.compactMap { element in
                if case .object(let obj) = element,
                   case .string("text")? = obj["type"],
                   case .string(let text)? = obj["text"] {
                    return text
                }
                return nil
            }
            if !textParts.isEmpty {
                return textParts.joined(separator: "\n")
            }
            return arr.map { $0.asDisplayString }.joined(separator: " ")
        case .object(let obj):
            return obj
                .map { "\($0.key)=\($0.value.asDisplayString)" }
                .joined(separator: " ")
        }
    }

    /// Best-effort integer extraction — `.number` is truncated to Int, a numeric
    /// `.string` is parsed. Used for usage metrics (total_tokens, tool_uses,
    /// duration_ms) on task_notification events (#sub-agent).
    var asInt: Int? {
        switch self {
        case .number(let n): return Int(n)
        case .string(let s): return Int(s) ?? Double(s).map { Int($0) }
        default: return nil
        }
    }

    /// Compact JSON-ish string of this value — used to LOG raw payloads whose
    /// shape we are still refining (e.g. system task events). Not a strict
    /// round-trip serializer; good enough for Console diagnosis.
    var jsonString: String {
        switch self {
        case .string(let s):
            let escaped = s
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
            return "\"\(escaped)\""
        case .number(let n):
            if n.rounded() == n, abs(n) < 1e15 { return String(Int(n)) }
            return String(n)
        case .bool(let b):
            return b ? "true" : "false"
        case .null:
            return "null"
        case .array(let arr):
            return "[" + arr.map { $0.jsonString }.joined(separator: ",") + "]"
        case .object(let obj):
            let pairs = obj.map { "\"\($0.key)\":\($0.value.jsonString)" }
            return "{" + pairs.joined(separator: ",") + "}"
        }
    }

    /// First scalar value found, scanning common keys then any value.
    /// Used to summarize a tool_use input (prefer command/file_path/pattern/path).
    var firstScalarSummary: String? {
        switch self {
        case .object(let obj):
            for key in ["command", "file_path", "path", "pattern", "query", "url", "description"] {
                if let v = obj[key], case let s = v.asDisplayString, !s.isEmpty {
                    return s
                }
            }
            // Fall back to the first non-empty scalar value
            for (_, v) in obj {
                let s = v.asDisplayString
                if !s.isEmpty { return s }
            }
            return nil
        default:
            let s = asDisplayString
            return s.isEmpty ? nil : s
        }
    }
}
