// FileApprovalManager.swift — #file-approval-manager
// Handles file request approval/denial with trust configuration and security checks.
// Mirrors the TypeScript file pipeline in symphony-loader.ts.

import Foundation
import CryptoKit

/// Errors that can occur during file approval.
enum FileApprovalError: Error, CustomStringConvertible {
    case notFound
    case alreadyResolved
    case pathTraversal
    case fileNotFound
    case readError(String)

    var description: String {
        switch self {
        case .notFound: return "File request not found"
        case .alreadyResolved: return "File request already resolved"
        case .pathTraversal: return "File path escapes project directory"
        case .fileNotFound: return "Requested file does not exist"
        case .readError(let msg): return "Failed to read file: \(msg)"
        }
    }
}

/// Manages file transfer request approval and denial.
/// Enforces trust configuration, hard-deny patterns, and path traversal protection.
@MainActor
final class FileApprovalManager {

    // MARK: - Hard-Deny Patterns

    /// Patterns that are always denied regardless of trust configuration.
    /// Matches the TypeScript `neverApprove` defaults in symphony-loader.ts.
    private static let hardDenyPatterns: [String] = [
        ".env*",
        "**/*.key",
        "**/*.pem",
        "**/credentials*",
        "**/secrets/**",
    ]

    /// Patterns for detecting secrets in file content for redaction.
    private static let secretPatterns: [String] = [
        "(?:api[_-]?key|secret|token|password|credential|auth)\\s*[:=]",
        "(?:^|\\s)(?:export\\s+)?[A-Z_]+(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)\\s*=",
        "-----BEGIN (?:RSA |EC )?PRIVATE KEY-----",
    ]

    // MARK: - Approval

    /// Approve a file request. Reads the file, computes SHA-256, creates delivery record.
    /// Updates the request record and sends a delivery note to the requester.
    func approve(
        _ requestId: String,
        projectDir: String,
        redact: Bool = false
    ) -> Result<FileDelivery, FileApprovalError> {
        // Load request record
        let requestPath = ScoreIO.fileRequestPath(for: requestId)
        guard var record: FileRequestRecord = ScoreIO.readJson(at: requestPath) else {
            return .failure(.notFound)
        }

        guard record.status == .pending else {
            return .failure(.alreadyResolved)
        }

        // Resolve absolute path
        let projectURL = URL(fileURLWithPath: projectDir).standardized
        let absoluteURL = projectURL.appendingPathComponent(record.request.filePath).standardized

        // Security: ensure file does not escape project directory
        guard absoluteURL.path.hasPrefix(projectURL.path) else {
            return .failure(.pathTraversal)
        }

        // Check file exists
        guard FileManager.default.fileExists(atPath: absoluteURL.path) else {
            return .failure(.fileNotFound)
        }

        // Read file content
        var content: String
        do {
            content = try String(contentsOf: absoluteURL, encoding: .utf8)
        } catch {
            return .failure(.readError(error.localizedDescription))
        }

        // Redact secrets if requested
        if redact {
            content = redactSecrets(content)
        }

        // Compute SHA-256 hash
        let hash = sha256Hex(content)

        let delivery = FileDelivery(
            requestId: requestId,
            filePath: record.request.filePath,
            content: content,
            encoding: .utf8,
            size: content.utf8.count,
            hash: hash
        )

        // Update request record
        record.status = .approved
        record.resolvedAt = ISO8601DateFormatter().string(from: Date())
        record.delivery = delivery
        ScoreIO.writeJson(record, to: requestPath)

        // Send delivery note to requester
        sendDeliveryNote(for: record, delivery: delivery)

        ConductorLog.component("file-approval-manager")
            .info("Approved file request \(requestId): \(record.request.filePath)")

        return .success(delivery)
    }

    // MARK: - Denial

    /// Deny a file request with an optional reason.
    /// Sends a denial note to the requester.
    @discardableResult
    func deny(_ requestId: String, reason: String? = nil) -> Bool {
        let requestPath = ScoreIO.fileRequestPath(for: requestId)
        guard var record: FileRequestRecord = ScoreIO.readJson(at: requestPath) else {
            return false
        }

        guard record.status == .pending else { return false }

        record.status = .denied
        record.resolvedAt = ISO8601DateFormatter().string(from: Date())
        record.denyReason = reason
        ScoreIO.writeJson(record, to: requestPath)

        // Send denial note to requester
        sendDenialNote(for: record, reason: reason)

        ConductorLog.component("file-approval-manager")
            .info("Denied file request \(requestId): \(record.request.filePath)")

        return true
    }

    // MARK: - Trust Checks

    /// Check if a file path is auto-approved by the trust configuration.
    func isAutoApproved(_ filePath: String, config: TrustConfig?) -> Bool {
        let trust = config ?? loadTrustConfig()

        // Hard deny always wins
        if isDenied(filePath, config: trust) { return false }

        // Check default auto-approve patterns
        for pattern in trust.defaults.autoApprove {
            if matchesGlob(filePath, pattern) { return true }
        }

        return false
    }

    /// Check if a file path is denied by the trust configuration or hard-deny patterns.
    func isDenied(_ filePath: String, config: TrustConfig?) -> Bool {
        let trust = config ?? loadTrustConfig()

        // Check hard-deny patterns first
        for pattern in Self.hardDenyPatterns {
            if matchesGlob(filePath, pattern) { return true }
        }

        // Check default never-approve patterns
        for pattern in trust.defaults.neverApprove {
            if matchesGlob(filePath, pattern) { return true }
        }

        return false
    }

    /// Load the trust configuration from ~/.paradigm/score/trust.yaml.
    /// Returns default config if file is missing or malformed.
    func loadTrustConfig() -> TrustConfig {
        let trustPath = ScoreIO.trustConfigPath

        guard FileManager.default.fileExists(atPath: trustPath.path) else {
            return defaultTrustConfig()
        }

        // Try to read as JSON (the TS implementation does the same fallback)
        if let config: TrustConfig = ScoreIO.readJson(at: trustPath) {
            return config
        }

        return defaultTrustConfig()
    }

    // MARK: - Private

    /// Default trust configuration matching the TypeScript DEFAULT_TRUST.
    private func defaultTrustConfig() -> TrustConfig {
        TrustConfig(
            users: [:],
            defaults: TrustEntry(
                level: .restricted,
                autoApprove: [],
                neverApprove: Self.hardDenyPatterns
            )
        )
    }

    /// Check if a file path matches a glob-like pattern.
    /// Supports: *, **, and ? wildcards.
    private func matchesGlob(_ filePath: String, _ pattern: String) -> Bool {
        // Convert glob to regex — same algorithm as TypeScript
        var regex = pattern
            .replacingOccurrences(of: ".", with: "\\.")
            .replacingOccurrences(of: "**", with: "{{GLOBSTAR}}")
            .replacingOccurrences(of: "*", with: "[^/]*")
            .replacingOccurrences(of: "?", with: "[^/]")
            .replacingOccurrences(of: "{{GLOBSTAR}}", with: ".*")

        regex = "^\(regex)$"

        guard let re = try? NSRegularExpression(pattern: regex) else { return false }
        let range = NSRange(filePath.startIndex..., in: filePath)
        return re.firstMatch(in: filePath, range: range) != nil
    }

    /// Redact lines containing potential secrets.
    /// Same patterns as the TypeScript implementation.
    private func redactSecrets(_ content: String) -> String {
        let compiledPatterns = Self.secretPatterns.compactMap { pattern in
            try? NSRegularExpression(pattern: pattern, options: .caseInsensitive)
        }

        return content.components(separatedBy: "\n").map { line in
            for regex in compiledPatterns {
                let range = NSRange(line.startIndex..., in: line)
                if regex.firstMatch(in: line, range: range) != nil {
                    return "[REDACTED]"
                }
            }
            return line
        }.joined(separator: "\n")
    }

    /// Compute SHA-256 hex digest of a string.
    private func sha256Hex(_ string: String) -> String {
        let data = Data(string.utf8)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// Send a file delivery note to the requester.
    private func sendDeliveryNote(for record: FileRequestRecord, delivery: FileDelivery) {
        let note = SymphonyNote(
            id: UUID().uuidString,
            threadRoot: record.request.threadRoot,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            sender: Participant(id: "system", name: "File Transfer", type: .human),
            recipients: [record.request.requester],
            intent: .fileDelivery,
            content: MessageContent(
                text: "File delivered: \(record.request.filePath) (\(delivery.size) bytes, SHA-256: \(String(delivery.hash.prefix(12)))...)"
            ),
            symbols: [],
            attachments: [
                Attachment(
                    name: URL(fileURLWithPath: record.request.filePath).lastPathComponent,
                    type: "file",
                    content: delivery.content,
                    encoding: .utf8
                )
            ]
        )

        ScoreIO.appendJsonl(note, to: ScoreIO.inboxPath(for: record.request.requester.id))
    }

    /// Send a file denial note to the requester.
    private func sendDenialNote(for record: FileRequestRecord, reason: String?) {
        let reasonSuffix = reason.map { " — \($0)" } ?? ""
        let note = SymphonyNote(
            id: UUID().uuidString,
            threadRoot: record.request.threadRoot,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            sender: Participant(id: "system", name: "File Transfer", type: .human),
            recipients: [record.request.requester],
            intent: .fileDenied,
            content: MessageContent(
                text: "File request denied: \(record.request.filePath)\(reasonSuffix)"
            ),
            symbols: []
        )

        ScoreIO.appendJsonl(note, to: ScoreIO.inboxPath(for: record.request.requester.id))
    }
}
