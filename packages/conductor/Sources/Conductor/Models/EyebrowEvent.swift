// EyebrowEvent.swift — #conductor-models
// Eyebrow raise/lower events and raw frame data from MediaPipe FaceMesh.

import Foundation

/// Discrete eyebrow events detected from raw distance data.
enum EyebrowEvent: Equatable, CustomStringConvertible {
    case leftRaise
    case leftLower
    case rightRaise
    case rightLower

    var description: String {
        switch self {
        case .leftRaise: return "leftRaise"
        case .leftLower: return "leftLower"
        case .rightRaise: return "rightRaise"
        case .rightLower: return "rightLower"
        }
    }
}

/// Raw eyebrow distance data from a single MediaPipe frame.
struct EyebrowFrame: Equatable {
    /// Distance from left eyebrow top to left eye upper lid (larger = more raised).
    let leftDistance: Double
    /// Distance from right eyebrow top to right eye upper lid (larger = more raised).
    let rightDistance: Double
}
