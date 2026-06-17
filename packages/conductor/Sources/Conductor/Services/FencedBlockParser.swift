// FencedBlockParser.swift — #fenced-block-parser
// Pure host-side parser that scans accumulated assistant TEXT for fenced blocks
// (```<lang>\n ... \n```) and projects the host-rendered ones into typed
// AgentDecision / AgentVisual values, returning the residual prose with those
// block spans stripped. This is the READER half of Scholar's contract
// (#session-prompt is the writer/instruction half).
//
// HARD RULES (Arky's spec):
//   - Emit a block ONLY when its CLOSING fence is present. An open fence still
//     streaming = leave it as pending raw text in the residual, render nothing yet.
//   - Strip emitted block spans from residualText.
//   - Stable identity: explicit JSON `id` if present, else (lang, ordinal) — so a
//     re-parse of a longer accumulated string keeps the same identity for a block
//     at the same ordinal, which lets the caller preserve a settled answer.
//   - Tolerate malformed JSON (when the closing fence IS present): degrade to a
//     plain fenced code block left in the residual text. NEVER throw.
//
// Recognized languages:
//   conductor-decision → AgentDecision
//   conductor-visual   → AgentVisual (envelope: kind flow|comparison|wireframe|diff)
//   mermaid            → AgentVisual(kind: .flow) (bare, no envelope)
//   svg                → AgentVisual(kind: .flow stub) — kept raw; v1 does not render
//   anything else      → left untouched in residual text (normal code block)

import Foundation

enum FencedBlockParser {

    struct ParseResult: Sendable {
        let residualText: String
        let decisions: [AgentDecision]
        let visuals: [AgentVisual]
    }

    /// Languages the host CONSUMES (strips from residual + projects to typed values).
    /// Any other fenced language is left untouched as a normal code block.
    private static let hostLanguages: Set<String> = [
        "conductor-decision", "conductor-visual", "mermaid", "svg",
    ]

    /// Parse the accumulated assistant text. Pure — no side effects.
    static func parse(_ accumulated: String) -> ParseResult {
        var decisions: [AgentDecision] = []
        var visuals: [AgentVisual] = []
        var residual = ""

        // Per-language ordinal for synthetic identity (lang, ordinal).
        var ordinalByLang: [String: Int] = [:]

        let scalars = Array(accumulated)
        var i = 0
        let n = scalars.count

        // Helper: is `pos` at the start of a line (col 0)?
        func atLineStart(_ pos: Int) -> Bool {
            pos == 0 || scalars[pos - 1] == "\n"
        }

        while i < n {
            // Look for a fence opener ``` at the start of a line.
            if atLineStart(i), matchFence(scalars, i) {
                // Parse the info string (language) up to end-of-line.
                var j = i + 3
                var lang = ""
                while j < n, scalars[j] != "\n" {
                    lang.append(scalars[j])
                    j += 1
                }
                lang = lang.trimmingCharacters(in: .whitespaces).lowercased()

                // Must have a newline after the info string to have a body.
                guard j < n else {
                    // Open fence at EOF, no newline yet → still streaming. Keep raw.
                    residual.append(contentsOf: scalars[i...])
                    break
                }
                let bodyStart = j + 1 // skip the newline

                // Find the CLOSING fence: ``` at the start of a line.
                var k = bodyStart
                var closeStart = -1
                while k < n {
                    if atLineStart(k), matchFence(scalars, k) {
                        closeStart = k
                        break
                    }
                    k += 1
                }

                if closeStart == -1 {
                    // No closing fence yet → block is still streaming. Render
                    // nothing; leave the whole partial fence as raw residual text.
                    residual.append(contentsOf: scalars[i...])
                    break
                }

                // Inner body is [bodyStart, closeStart). Trim the trailing newline
                // that precedes the closing fence.
                var bodyEnd = closeStart
                if bodyEnd > bodyStart, scalars[bodyEnd - 1] == "\n" { bodyEnd -= 1 }
                let body = String(scalars[bodyStart..<bodyEnd])

                // Advance past the closing fence line.
                var afterClose = closeStart + 3
                while afterClose < n, scalars[afterClose] != "\n" { afterClose += 1 }
                if afterClose < n { afterClose += 1 } // consume the newline

                if hostLanguages.contains(lang) {
                    let ordinal = ordinalByLang[lang, default: 0]
                    ordinalByLang[lang] = ordinal + 1
                    project(lang: lang, body: body, ordinal: ordinal,
                            into: &decisions, &visuals)
                    // Stripped from residual entirely.
                } else {
                    // Not a host language → keep the whole fenced block verbatim.
                    residual.append(contentsOf: scalars[i..<afterClose])
                }
                i = afterClose
                continue
            }

            residual.append(scalars[i])
            i += 1
        }

        // Collapse the holes left by stripped blocks: trim runs of 3+ newlines to 2.
        let cleaned = collapseBlankRuns(residual)
        return ParseResult(residualText: cleaned, decisions: decisions, visuals: visuals)
    }

    // MARK: - Fence matching

    /// True if scalars[pos..<pos+3] == "```".
    private static func matchFence(_ scalars: [Character], _ pos: Int) -> Bool {
        pos + 2 < scalars.count
            && scalars[pos] == "`" && scalars[pos + 1] == "`" && scalars[pos + 2] == "`"
    }

    // MARK: - Projection

    private static func project(
        lang: String,
        body: String,
        ordinal: Int,
        into decisions: inout [AgentDecision],
        _ visuals: inout [AgentVisual]
    ) {
        switch lang {
        case "conductor-decision":
            if let d = decodeDecision(body, ordinal: ordinal) {
                decisions.append(d)
            } else {
                ConductorLog.component("fenced-block-parser")
                    .error("Malformed conductor-decision JSON (ordinal \(ordinal)) — dropped block")
            }
        case "conductor-visual":
            if let v = decodeVisualEnvelope(body, ordinal: ordinal) {
                visuals.append(v)
            } else {
                ConductorLog.component("fenced-block-parser")
                    .error("Malformed conductor-visual JSON (ordinal \(ordinal)) — dropped block")
            }
        case "mermaid":
            // Bare mermaid → a flow visual with the body as source.
            let id = "mermaid-\(ordinal)"
            visuals.append(AgentVisual(id: id, kind: .flow, title: nil,
                                       mermaid: body, comparison: nil, raw: body))
        case "svg":
            // v1 does not render svg; capture raw so v2 can. Reuse .flow kind slot
            // but keep mermaid nil so the canvas falls through to raw.
            let id = "svg-\(ordinal)"
            visuals.append(AgentVisual(id: id, kind: .flow, title: nil,
                                       mermaid: nil, comparison: nil, raw: body))
        default:
            break
        }
    }

    // MARK: - JSON decode (tolerant)

    private static func data(_ s: String) -> Data { Data(s.utf8) }

    private static func decodeDecision(_ body: String, ordinal: Int) -> AgentDecision? {
        guard let obj = jsonObject(body) else { return nil }
        guard let question = obj["question"] as? String, !question.isEmpty else { return nil }
        let id = (obj["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "decision-\(ordinal)"
        let multiSelect = (obj["multiSelect"] as? Bool) ?? false
        let allowOther = (obj["allowOther"] as? Bool) ?? false

        var options: [DecisionOption] = []
        if let rawOptions = obj["options"] as? [[String: Any]] {
            for (idx, ro) in rawOptions.enumerated() {
                let oid = (ro["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "opt-\(idx)"
                let label = (ro["label"] as? String) ?? oid
                let desc = (ro["description"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                let recommended = (ro["recommended"] as? Bool) ?? false
                let visualId = (ro["visualId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                options.append(DecisionOption(id: oid, label: label, description: desc,
                                              recommended: recommended, visualId: visualId))
            }
        }
        guard !options.isEmpty else { return nil }
        return AgentDecision(id: id, question: question, options: options,
                             multiSelect: multiSelect, allowOther: allowOther, answer: nil)
    }

    private static func decodeVisualEnvelope(_ body: String, ordinal: Int) -> AgentVisual? {
        guard let obj = jsonObject(body) else { return nil }
        let kindRaw = (obj["kind"] as? String)?.lowercased() ?? ""
        let kind = VisualKind(rawValue: kindRaw) ?? .flow
        let id = (obj["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "visual-\(ordinal)"
        let title = (obj["title"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let payload = obj["payload"] as? [String: Any]

        switch kind {
        case .flow:
            let mermaid = (payload?["mermaid"] as? String) ?? (obj["mermaid"] as? String)
            guard let mermaid, !mermaid.isEmpty else { return nil }
            return AgentVisual(id: id, kind: .flow, title: title,
                               mermaid: mermaid, comparison: nil, raw: body)
        case .comparison:
            guard let comparison = decodeComparison(payload) else { return nil }
            return AgentVisual(id: id, kind: .comparison, title: title,
                               mermaid: nil, comparison: comparison, raw: body)
        case .wireframe, .diff:
            // v2 kinds — decode-tolerant, kept raw; canvas shows a v2 placeholder.
            return AgentVisual(id: id, kind: kind, title: title,
                               mermaid: nil, comparison: nil, raw: body)
        }
    }

    private static func decodeComparison(_ payload: [String: Any]?) -> ComparisonTable? {
        guard let payload else { return nil }
        let columns = (payload["columns"] as? [String]) ?? []
        guard !columns.isEmpty else { return nil }
        var rows: [ComparisonRow] = []
        if let rawRows = payload["rows"] as? [[String: Any]] {
            for rr in rawRows {
                let label = (rr["label"] as? String) ?? ""
                let cells = (rr["cells"] as? [Any])?.map { anyToString($0) } ?? []
                rows.append(ComparisonRow(label: label, cells: cells))
            }
        }
        return ComparisonTable(columns: columns, rows: rows)
    }

    private static func jsonObject(_ body: String) -> [String: Any]? {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let parsed = try? JSONSerialization.jsonObject(with: data(trimmed)),
              let obj = parsed as? [String: Any]
        else { return nil }
        return obj
    }

    private static func anyToString(_ v: Any) -> String {
        switch v {
        case let s as String: return s
        case let b as Bool: return b ? "true" : "false"
        case let n as NSNumber: return n.stringValue
        default: return String(describing: v)
        }
    }

    // MARK: - Residual cleanup

    /// Collapse runs of 3+ consecutive newlines (left behind by stripped blocks)
    /// down to a single blank line, and trim leading/trailing whitespace.
    private static func collapseBlankRuns(_ s: String) -> String {
        var out = ""
        var newlineRun = 0
        for ch in s {
            if ch == "\n" {
                newlineRun += 1
                if newlineRun <= 2 { out.append(ch) }
            } else {
                newlineRun = 0
                out.append(ch)
            }
        }
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
