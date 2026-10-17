// swift-tools-version: 5.9
// Gnomon helper (darwin) — the signed, entitled helper for the Gnomon kernel:
// Secure Enclave keys with presence, Keychain anchors + kernel-key item,
// LaunchServices URL hand-off (docs/specs/gnomon.md §16, §18). PR-0 scaffold.

import PackageDescription

let package = Package(
    name: "GnomonHelper",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "gnomon-helper", targets: ["gnomon-helper"])
    ],
    targets: [
        .executableTarget(
            name: "gnomon-helper",
            path: "Sources/gnomon-helper"
        )
    ]
)
