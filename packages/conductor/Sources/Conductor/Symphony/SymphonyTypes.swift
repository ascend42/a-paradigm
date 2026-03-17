// SymphonyTypes.swift — #symphony-types
// Wire-compatible Codable structs matching the TypeScript types in symphony-loader.ts.
// All property names use camelCase to match JSON output from Node.js.
// Dates are ISO 8601 strings (not Date) for byte-level compatibility.

import Foundation

// MARK: - Participant

enum ParticipantType: String, Codable, Sendable {
    case agent
    case human
}

struct Participant: Codable, Sendable, Equatable {
    let id: String
    let name: String
    let type: ParticipantType
    var project: String?
    var role: String?
}

// MARK: - Message Intent

enum MessageIntent: String, Codable, Sendable {
    case question
    case context
    case clarification
    case proposal
    case verification
    case action
    case decision
    case alert
    case approval
    case rejection
    case reference
    case handoff
    case fileRequest
    case fileApproved
    case fileDenied
    case fileDelivery
    // Task protocol intents (Sprint 10)
    case task
    case taskAck = "task-ack"
    case progress
    case approvalRequest = "approval-request"
    case approvalResponse = "approval-response"
    case taskComplete = "task-complete"
    case taskFailed = "task-failed"
}

// MARK: - Task Protocol Payloads

enum TaskPriority: String, Codable, Sendable {
    case low
    case normal
    case high
    case critical
}

struct TaskPayload: Codable, Sendable {
    let taskId: String
    let scope: String
    let acceptance: String
    let priority: TaskPriority
    var deadline: String?
    var externalRef: String?
    var assignedTo: String?
    var assignedBy: String?
    var parentTaskId: String?
    var tags: [String]?
}

struct ProgressPayload: Codable, Sendable {
    let taskId: String
    let percent: Int
    let summary: String
    var filesModified: [String]?
    var symbolsTouched: [String]?
    var blockers: [String]?
}

struct ApprovalRequestPayload: Codable, Sendable {
    let taskId: String
    let summary: String
    let filesModified: [String]
    var diff: String?
    let question: String
    let options: [String]
}

enum ApprovalDecision: String, Codable, Sendable {
    case approved
    case rejected
    case redirected
}

struct ApprovalResponsePayload: Codable, Sendable {
    let taskId: String
    let decision: ApprovalDecision
    var feedback: String?
    var redirectTo: String?
}

// MARK: - Message Content

struct MessageContent: Codable, Sendable {
    let text: String
    var diff: String?
    var decision: String?
}

// MARK: - Attachment

struct Attachment: Codable, Sendable {
    let name: String
    let type: String
    let content: String
    var encoding: AttachmentEncoding?
}

enum AttachmentEncoding: String, Codable, Sendable {
    case utf8
    case base64
}

// MARK: - Message Metadata

struct MessageMetadata: Codable, Sendable {
    var toolCall: String?
    var symbols: [String]?
    var confidence: Double?
    // Task protocol payloads
    var task: TaskPayload?
    var progress: ProgressPayload?
    var approvalRequest: ApprovalRequestPayload?
    var approvalResponse: ApprovalResponsePayload?
}

// MARK: - Symphony Note (SymphonyMessage in TS)

/// A single note in The Score — renamed from SymphonyMessage for Phase 1.
/// Wire-compatible with the TypeScript `SymphonyMessage` interface.
struct SymphonyNote: Codable, Sendable, Identifiable {
    let id: String
    var parentId: String?
    var threadRoot: String?
    let timestamp: String
    let sender: Participant
    var recipients: [Participant]?
    let intent: MessageIntent
    let content: MessageContent
    let symbols: [String]
    var attachments: [Attachment]?
    var metadata: MessageMetadata?
}

// MARK: - Agent Identity

struct AgentIdentity: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let name: String
    let type: ParticipantType
    let project: String
    let role: String
    let pid: Int
    let startedAt: String
    var lastPoll: String?
    var label: String?

    static func == (lhs: AgentIdentity, rhs: AgentIdentity) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Thread Metadata

enum ThreadStatus: String, Codable, Sendable {
    case active
    case resolved
}

struct ThreadMeta: Codable, Sendable, Identifiable {
    let id: String
    let topic: String
    let initiator: Participant
    var participants: [Participant]
    var status: ThreadStatus
    let createdAt: String
    var lastActivity: String
    var messageCount: Int
    var decision: String?
    var resolvedAt: String?
}

// MARK: - File Transfer

enum FileUrgency: String, Codable, Sendable {
    case normal
    case urgent
}

enum FileEncoding: String, Codable, Sendable {
    case utf8
    case base64
}

struct FileRequest: Codable, Sendable {
    let requestId: String
    let filePath: String
    let reason: String
    let requester: Participant
    let urgency: FileUrgency
    var snippet: String?
    var threadRoot: String?
}

struct FileDelivery: Codable, Sendable {
    let requestId: String
    let filePath: String
    let content: String
    let encoding: FileEncoding
    let size: Int
    let hash: String
}

enum FileRequestStatus: String, Codable, Sendable {
    case pending
    case approved
    case denied
    case expired
}

struct FileRequestRecord: Codable, Sendable {
    let request: FileRequest
    var status: FileRequestStatus
    let createdAt: String
    var resolvedAt: String?
    var resolvedBy: String?
    var denyReason: String?
    var delivery: FileDelivery?
}

// MARK: - Trust Configuration

enum TrustLevel: String, Codable, Sendable {
    case teammate
    case restricted
    case blocked
}

struct TrustEntry: Codable, Sendable {
    let level: TrustLevel
    let autoApprove: [String]
    let neverApprove: [String]
}

struct TrustConfig: Codable, Sendable {
    var users: [String: TrustEntry]
    var defaults: TrustEntry
}

// MARK: - Ack

struct AckRecord: Codable, Sendable {
    let lastAck: String
}
