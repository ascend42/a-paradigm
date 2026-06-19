// swift-tools-version: 5.9
// Paradigm Conductor — Multimodal mission control for Claude Code sessions

import PackageDescription

let package = Package(
    name: "Conductor",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "Conductor", targets: ["Conductor"])
    ],
    dependencies: [
        .package(url: "https://github.com/argmaxinc/WhisperKit.git", from: "0.16.0"),
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", from: "1.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "Conductor",
            dependencies: [
                .product(name: "WhisperKit", package: "WhisperKit"),
                .product(name: "SwiftTerm", package: "SwiftTerm"),
            ],
            path: "Sources/Conductor",
            resources: [
                .copy("../../Resources"),
                // VENDORED OFFLINE mermaid.min.js for the LIGHTBOX (#atrium-visual-canvas /
                // #mermaid-web-view). Declared as an IN-TARGET resource so SwiftPM reliably
                // emits the Conductor_Conductor.bundle that build-conductor.sh copies into
                // the .app (a ../../Resources folder-copy alone did NOT emit the bundle).
                .copy("Resources/mermaid.min.js"),
            ]
        ),
        .testTarget(
            name: "ConductorTests",
            dependencies: ["Conductor"],
            path: "Tests/ConductorTests"
        )
    ]
)
