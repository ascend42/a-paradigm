// swift-tools-version: 5.9
// gnomon-voice-io (darwin): the voice child's audio I/O (TD-2026-10-19-298,
// slice V2b, T-2026-10-19-026). Mic capture with voice processing (VPIO AEC),
// TTS playback through the SAME engine, output-route reporting and global
// hotkeys (Carbon). Mic only: no keychain group, no network, no files written.
//
// VoiceIOCore is pure (frame codec, command parser, hotkey config, level and
// route math), so `swift test` needs no audio hardware; the executable target
// holds AVAudioEngine, CoreAudio and Carbon.

import PackageDescription

let package = Package(
    name: "GnomonVoiceIO",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "gnomon-voice-io", targets: ["gnomon-voice-io"])
    ],
    targets: [
        .target(
            name: "VoiceIOCore",
            path: "Sources/VoiceIOCore"
        ),
        .executableTarget(
            name: "gnomon-voice-io",
            dependencies: ["VoiceIOCore"],
            path: "Sources/gnomon-voice-io"
        ),
        .testTarget(
            name: "VoiceIOCoreTests",
            dependencies: ["VoiceIOCore"],
            path: "Tests/VoiceIOCoreTests"
        ),
    ]
)
