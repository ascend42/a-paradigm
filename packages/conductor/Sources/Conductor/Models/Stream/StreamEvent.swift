// StreamEvent.swift — #stream-event
// Typed decode of the `claude --output-format stream-json` NDJSON event stream.
// Every line is one complete JSON object; unknown shapes degrade to .unknown
// rather than throwing, so the stream never breaks on a new event type.

import Foundation

/// Token usage attached to assistant/result events.
struct Usage: Decodable, Sendable {
    let inputTokens: Int?
    let outputTokens: Int?
    let cacheReadInputTokens: Int?
    let cacheCreationInputTokens: Int?

    enum CodingKeys: String, CodingKey {
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case cacheReadInputTokens = "cache_read_input_tokens"
        case cacheCreationInputTokens = "cache_creation_input_tokens"
    }
}

/// A single content block within an API message. Discriminated by "type".
enum ContentBlock: Decodable, Sendable {
    case text(String)
    case thinking
    case toolUse(id: String, name: String, input: JSONValue)
    case toolResult(toolUseId: String, content: String, isError: Bool)
    case other(type: String)

    enum CodingKeys: String, CodingKey {
        case type
        case text
        case id
        case name
        case input
        case toolUseId = "tool_use_id"
        case content
        case isError = "is_error"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = (try? container.decode(String.self, forKey: .type)) ?? "unknown"

        switch type {
        case "text":
            let text = (try? container.decode(String.self, forKey: .text)) ?? ""
            self = .text(text)
        case "thinking":
            self = .thinking
        case "tool_use":
            let id = (try? container.decode(String.self, forKey: .id)) ?? ""
            let name = (try? container.decode(String.self, forKey: .name)) ?? "tool"
            let input = (try? container.decode(JSONValue.self, forKey: .input)) ?? .null
            self = .toolUse(id: id, name: name, input: input)
        case "tool_result":
            let toolUseId = (try? container.decode(String.self, forKey: .toolUseId)) ?? ""
            // content can be a String OR an array — decode as JSONValue and flatten.
            let raw = (try? container.decode(JSONValue.self, forKey: .content)) ?? .null
            let isError = (try? container.decode(Bool.self, forKey: .isError)) ?? false
            self = .toolResult(toolUseId: toolUseId, content: raw.asDisplayString, isError: isError)
        default:
            self = .other(type: type)
        }
    }
}

/// A Claude API message (assistant or user) carried inside a stream event.
struct APIMessage: Decodable, Sendable {
    let id: String?
    let role: String?
    let content: [ContentBlock]
    let usage: Usage?

    enum CodingKeys: String, CodingKey {
        case id, role, content, usage
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try? container.decode(String.self, forKey: .id)
        role = try? container.decode(String.self, forKey: .role)
        content = (try? container.decode([ContentBlock].self, forKey: .content)) ?? []
        usage = try? container.decode(Usage.self, forKey: .usage)
    }
}

/// `{"type":"system","subtype":"init",...}`
struct SystemInit: Decodable, Sendable {
    let sessionId: String?
    let model: String?
    let tools: [String]?
    let permissionMode: String?

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case model
        case tools
        case permissionMode
    }
}

/// `{"type":"assistant","message":{...},"session_id":...}`
struct AssistantMessage: Decodable, Sendable {
    let message: APIMessage
    let sessionId: String?

    enum CodingKeys: String, CodingKey {
        case message
        case sessionId = "session_id"
    }
}

/// `{"type":"user","message":{...}}` — carries tool_result blocks.
struct UserMessage: Decodable, Sendable {
    let message: APIMessage
}

/// `{"type":"result","subtype":"success","result":"...","total_cost_usd":...}`
struct ResultEvent: Decodable, Sendable {
    let subtype: String?
    let result: String?
    let totalCostUsd: Double?
    let sessionId: String?
    let usage: Usage?
    let isError: Bool?

    enum CodingKeys: String, CodingKey {
        case subtype
        case result
        case totalCostUsd = "total_cost_usd"
        case sessionId = "session_id"
        case usage
        case isError = "is_error"
    }
}

/// A single decoded line from the stream-json NDJSON output.
enum StreamEvent: Decodable, Sendable {
    case system(SystemInit)
    case assistant(AssistantMessage)
    case user(UserMessage)
    case result(ResultEvent)
    case unknown(type: String)

    private enum TypeKey: String, CodingKey { case type }

    init(from decoder: Decoder) throws {
        let typeContainer = try decoder.container(keyedBy: TypeKey.self)
        let type = (try? typeContainer.decode(String.self, forKey: .type)) ?? "unknown"

        switch type {
        case "system":
            // Tolerate subtypes other than init — they still decode into SystemInit fields.
            self = .system(try SystemInit(from: decoder))
        case "assistant":
            self = .assistant(try AssistantMessage(from: decoder))
        case "user":
            self = .user(try UserMessage(from: decoder))
        case "result":
            self = .result(try ResultEvent(from: decoder))
        default:
            self = .unknown(type: type)
        }
    }
}
