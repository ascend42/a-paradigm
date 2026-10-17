// gnomon-helper (darwin) — PR-0 scaffold. Prints its version; every other
// invocation is refused until the helper's verbs land (M1.1).

import Foundation

let gnomonHelperVersion = "1.0.0"

let arguments = CommandLine.arguments.dropFirst()

if arguments.contains("--version") || arguments.contains("-v") {
    print("gnomon-helper \(gnomonHelperVersion)")
    exit(0)
}

FileHandle.standardError.write(
    "gnomon-helper \(gnomonHelperVersion): not implemented yet (Gnomon PR-0 scaffold)\n".data(using: .utf8)!
)
exit(2)
