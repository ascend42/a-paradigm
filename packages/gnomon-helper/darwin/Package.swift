// swift-tools-version: 5.9
// Gnomon helper (darwin) — the signed, entitled helper for the Gnomon kernel:
// Secure Enclave keys with presence, Keychain anchors + kernel-key item,
// LaunchServices URL hand-off (docs/specs/gnomon.md §16, §18). PR-0 scaffold.
// 1.6.0: unit tests (`swift test`) over the executable target (@testable import
// gnomon_helper): arm custody, signature domains, the session observer.
// 1.7.0: the unlock bounds (12 h / 512, reported on a kept sign; UnlockBoundsTests).

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
        ),
        .testTarget(
            name: "gnomon-helper-tests",
            dependencies: ["gnomon-helper"],
            path: "Tests/gnomon-helper-tests"
        ),
    ]
)
