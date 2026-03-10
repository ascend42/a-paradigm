// swift-tools-version: 5.9
// Paradigm Conductor — Multimodal mission control for Claude Code sessions

import PackageDescription

let package = Package(
    name: "Conductor",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "conductor", targets: ["Conductor"])
    ],
    dependencies: [
        // WhisperKit will be added in Sprint 2
        // .package(url: "https://github.com/argmaxinc/WhisperKit.git", from: "0.9.0"),
    ],
    targets: [
        .executableTarget(
            name: "Conductor",
            dependencies: [],
            path: "Sources/Conductor",
            resources: [
                .copy("../../Resources")
            ]
        ),
        .testTarget(
            name: "ConductorTests",
            dependencies: ["Conductor"],
            path: "Tests/ConductorTests"
        )
    ]
)
