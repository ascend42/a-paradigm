// VoiceMode.swift — #conductor-models
// Voice input mode configuration.

import Foundation

/// How voice input is activated.
enum VoiceMode: Equatable {
    /// Hold a hotkey to record, release to transcribe.
    case pushToTalk

    /// Always listening, uses VAD to detect speech boundaries.
    case continuous

    /// Eyebrow raise starts recording, eyebrow lower stops.
    case eyebrowTrigger
}
