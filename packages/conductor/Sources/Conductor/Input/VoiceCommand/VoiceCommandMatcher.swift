// VoiceCommandMatcher.swift — #voice-command-matcher
// Scans transcription text for registered phrase→action bindings.
// Fuzzy matching with Levenshtein distance.

import Foundation

/// Scans transcription text for voice command phrases and extracts matching actions.
struct VoiceCommandMatcher {

    /// Result of matching a transcription against voice commands.
    struct MatchResult: Equatable {
        /// Text remaining after extracting the command phrase.
        let remainingText: String
        /// The matched action, if any.
        let action: ConductorAction?
        /// The phrase that was matched.
        let matchedPhrase: String?
    }

    /// Maximum Levenshtein distance for fuzzy matching (per word).
    var fuzzyTolerance: Int = 1

    /// Check a transcription against registered commands.
    /// Scans for phrases at the start or end of the text.
    func match(
        transcription: String,
        commands: [String: ConductorAction]
    ) -> MatchResult {
        let text = transcription.trimmingCharacters(in: .whitespacesAndNewlines)
        let lowerText = text.lowercased()

        // Sort by phrase length (longest first) to prefer more specific matches
        let sortedCommands = commands.sorted { $0.key.count > $1.key.count }

        for (phrase, action) in sortedCommands {
            let lowerPhrase = phrase.lowercased()

            // Check exact match at end
            if lowerText.hasSuffix(lowerPhrase) {
                let remaining = String(text.dropLast(phrase.count))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                return MatchResult(remainingText: remaining, action: action, matchedPhrase: phrase)
            }

            // Check exact match at start
            if lowerText.hasPrefix(lowerPhrase) {
                let remaining = String(text.dropFirst(phrase.count))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                return MatchResult(remainingText: remaining, action: action, matchedPhrase: phrase)
            }

            // Fuzzy match at end
            if fuzzyTolerance > 0 {
                let words = lowerText.split(separator: " ")
                let phraseWords = lowerPhrase.split(separator: " ")

                if phraseWords.count <= words.count {
                    // Check suffix
                    let suffixWords = words.suffix(phraseWords.count)
                    if fuzzyMatch(Array(suffixWords), phraseWords) {
                        let prefixWords = words.dropLast(phraseWords.count)
                        let remaining = prefixWords.joined(separator: " ")
                        return MatchResult(remainingText: remaining, action: action, matchedPhrase: phrase)
                    }

                    // Check prefix
                    let prefixWords2 = words.prefix(phraseWords.count)
                    if fuzzyMatch(Array(prefixWords2), phraseWords) {
                        let suffixWords2 = words.dropFirst(phraseWords.count)
                        let remaining = suffixWords2.joined(separator: " ")
                        return MatchResult(remainingText: remaining, action: action, matchedPhrase: phrase)
                    }
                }
            }
        }

        return MatchResult(remainingText: text, action: nil, matchedPhrase: nil)
    }

    // MARK: - Fuzzy Matching

    private func fuzzyMatch(_ words: [Substring], _ phraseWords: [Substring]) -> Bool {
        guard words.count == phraseWords.count else { return false }
        for (word, phraseWord) in zip(words, phraseWords) {
            if levenshteinDistance(String(word), String(phraseWord)) > fuzzyTolerance {
                return false
            }
        }
        return true
    }

    /// Compute Levenshtein edit distance between two strings.
    static func levenshteinDistance(_ a: String, _ b: String) -> Int {
        let aChars = Array(a)
        let bChars = Array(b)
        let n = aChars.count
        let m = bChars.count

        if n == 0 { return m }
        if m == 0 { return n }

        var matrix = Array(repeating: Array(repeating: 0, count: m + 1), count: n + 1)

        for i in 0...n { matrix[i][0] = i }
        for j in 0...m { matrix[0][j] = j }

        for i in 1...n {
            for j in 1...m {
                let cost = aChars[i - 1] == bChars[j - 1] ? 0 : 1
                matrix[i][j] = min(
                    matrix[i - 1][j] + 1,      // deletion
                    matrix[i][j - 1] + 1,      // insertion
                    matrix[i - 1][j - 1] + cost // substitution
                )
            }
        }

        return matrix[n][m]
    }

    private func levenshteinDistance(_ a: String, _ b: String) -> Int {
        Self.levenshteinDistance(a, b)
    }
}
