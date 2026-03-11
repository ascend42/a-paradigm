// DTWMatcher.swift — #dtw-matcher
// Dynamic Time Warping implementation for comparing hand pose time-series.
// Pure algorithm — no dependencies on Vision or AVFoundation.

import Foundation

/// Dynamic Time Warping matcher for hand pose sequences.
struct DTWMatcher {

    /// Compute the DTW distance between two hand pose sequences.
    /// Returns a normalized distance (lower = more similar).
    static func match(_ sequence: [HandPoseFrame], against template: GestureTemplate) -> Double {
        return distance(sequence, template.frames)
    }

    /// Check if a sequence matches a template within its threshold.
    static func isMatch(_ sequence: [HandPoseFrame], template: GestureTemplate) -> Bool {
        return match(sequence, against: template) <= template.matchThreshold
    }

    /// Compute DTW distance between two frame sequences.
    static func distance(_ seq1: [HandPoseFrame], _ seq2: [HandPoseFrame]) -> Double {
        let n = seq1.count
        let m = seq2.count

        guard n > 0 && m > 0 else { return .infinity }

        // DTW cost matrix
        var dtw = Array(repeating: Array(repeating: Double.infinity, count: m + 1), count: n + 1)
        dtw[0][0] = 0

        for i in 1...n {
            for j in 1...m {
                let cost = frameDistance(seq1[i - 1], seq2[j - 1])
                dtw[i][j] = cost + min(
                    dtw[i - 1][j],     // insertion
                    dtw[i][j - 1],     // deletion
                    dtw[i - 1][j - 1]  // match
                )
            }
        }

        // Normalize by path length
        let pathLength = Double(n + m)
        return dtw[n][m] / pathLength
    }

    /// Euclidean distance between two frames' joint positions.
    static func frameDistance(_ a: HandPoseFrame, _ b: HandPoseFrame) -> Double {
        let jointsA = a.jointPositions
        let jointsB = b.jointPositions

        guard jointsA.count == jointsB.count else { return .infinity }

        var sumSqDist = 0.0
        for (ja, jb) in zip(jointsA, jointsB) {
            let dist = ja.distance(to: jb)
            sumSqDist += dist * dist
        }

        return sumSqDist.squareRoot()
    }
}
