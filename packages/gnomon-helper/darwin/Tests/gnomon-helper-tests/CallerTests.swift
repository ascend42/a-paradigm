// gnomon-helper 1.11.0 (G-HLP-03): the caller check falsifiers. callerRefusal is pure; the production probe is run
// for real once (under `swift test` stdin is not the kernel's socket, so it must refuse).

import Foundation
import XCTest
@testable import gnomon_helper

/// The facts of the signed release kernel that spawned us.
func kernelFacts() -> CallerFacts {
    var f = CallerFacts()
    f.tokenPid = 4242
    f.pidVersion = 7
    f.parentPid = 4242
    f.startParentPid = 4242
    f.matchedIdentifier = kernelReleaseIdentifier
    f.signedIdentifier = kernelReleaseIdentifier
    f.cdhash = String(repeating: "ab", count: 20)
    f.stamp = KernelStamp(profile: "release", version: "8.1.0")
    f.startedAt = Date(timeIntervalSince1970: 1_800_000_000)
    return f
}

final class FixedCaller: CallerProbe {
    var f: CallerFacts
    init(_ f: CallerFacts = kernelFacts()) { self.f = f }
    func facts() -> CallerFacts { f }
}

final class CallerTests: XCTestCase {
    func testTheSignedReleaseKernelPasses() {
        XCTAssertNil(callerRefusal(kernelFacts(), acceptDev: false))
    }

    func testTheRequirementIsHardcoded() {
        XCTAssertEqual(kernelRequirement(kernelReleaseIdentifier),
                       "anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"SW4BMQ8PNL\" and identifier \"gnomon.kernel\"")
        XCTAssertFalse(helperAcceptsDevKernel, "swift test builds the release helper: no -DGNOMON_HELPER_DEV")
    }

    func testANonKernelCallerIsRefused() {
        var f = kernelFacts()
        f.matchedIdentifier = nil
        f.signedIdentifier = "com.example.other"
        XCTAssertEqual(callerRefusal(f, acceptDev: true)?.code, "caller-refused")
        var node = kernelFacts()
        node.signedIdentifier = "gnomon.node"
        XCTAssertNotNil(callerRefusal(node, acceptDev: true), "gnomon.node is never the kernel")
        var nodeDev = kernelFacts()
        nodeDev.signedIdentifier = "gnomon.node.dev"
        XCTAssertNotNil(callerRefusal(nodeDev, acceptDev: true))
    }

    func testAnAdhocKernelIsRefused() {
        var f = kernelFacts()
        f.adhoc = true
        XCTAssertNotNil(callerRefusal(f, acceptDev: true))
    }

    func testAnOlderKernelIsRefused() {
        var f = kernelFacts()
        f.stamp = KernelStamp(profile: "release", version: "8.0.9")
        XCTAssertNotNil(callerRefusal(f, acceptDev: false))
        f.stamp = nil
        XCTAssertNotNil(callerRefusal(f, acceptDev: false), "no stamp: refused")
        f.stamp = KernelStamp(profile: "release", version: "8.1.1")
        XCTAssertNil(callerRefusal(f, acceptDev: false))
    }

    func testADevKernelOnlyInADevHelper() {
        var f = kernelFacts()
        f.matchedIdentifier = kernelDevIdentifier
        f.signedIdentifier = kernelDevIdentifier
        f.stamp = KernelStamp(profile: "dev", version: "8.1.0")
        XCTAssertNotNil(callerRefusal(f, acceptDev: false), "a release helper refuses gnomon.kernel.dev")
        XCTAssertNil(callerRefusal(f, acceptDev: true))
        f.stamp = KernelStamp(profile: "release", version: "8.1.0")
        XCTAssertNotNil(callerRefusal(f, acceptDev: true), "the stamp's profile matches the identifier")
    }

    func testHardenedRuntimeAndNoGetTaskAllow() {
        var f = kernelFacts()
        f.hardenedRuntime = false
        XCTAssertNotNil(callerRefusal(f, acceptDev: false))
        f = kernelFacts()
        f.getTaskAllow = true
        XCTAssertNotNil(callerRefusal(f, acceptDev: false))
    }

    func testTheParentMustBeThePeerAndUnchanged() {
        var f = kernelFacts()
        f.tokenPid = 999
        XCTAssertNotNil(callerRefusal(f, acceptDev: false), "the peer is not our parent")
        f = kernelFacts()
        f.parentPid = 1
        f.tokenPid = 1
        XCTAssertNotNil(callerRefusal(f, acceptDev: false), "re-parented to launchd")
        f = kernelFacts()
        f.startParentPid = 77
        XCTAssertNotNil(callerRefusal(f, acceptDev: false), "the parent changed since start")
        f = kernelFacts()
        f.stdinIsSocket = false
        XCTAssertNotNil(callerRefusal(f, acceptDev: false))
    }

    func testTheGateBindsOneProcessInstance() throws {
        let p = FixedCaller()
        let gate = CallerGate(probe: p, acceptDev: false)
        XCTAssertEqual(try gate.require().pidVersion, 7)
        p.f.pidVersion = 8 // the same pid, another process instance
        XCTAssertThrowsError(try gate.require())
    }

    func testTheRealProbeRefusesThisTestProcess() {
        // swift test: stdin is not a socket from a signed gnomon.kernel
        let gate = CallerGate(probe: SystemCallerProbe(), acceptDev: true)
        XCTAssertThrowsError(try gate.require()) { e in XCTAssertEqual((e as? HelperError)?.code, "caller-refused") }
    }

    func testStampParsing() {
        XCTAssertEqual(parseKernelStamp(Data("gnomon-kernel-stamp:v1\n{\"profile\":\"release\",\"version\":\"8.1.0\"}\u{0}\u{0}".utf8)), KernelStamp(profile: "release", version: "8.1.0"))
        XCTAssertNil(parseKernelStamp(Data("gnomon-kernel-stamp:v2\n{\"profile\":\"release\",\"version\":\"8.1.0\"}".utf8)))
        XCTAssertNil(parseKernelStamp(Data("gnomon-kernel-stamp:v1\n{\"profile\":\"probe\",\"version\":\"8.1.0\"}".utf8)))
        // a Mach-O without the section (this test binary's own executable) has no stamp
        XCTAssertNil(readKernelStamp(path: CommandLine.arguments[0]))
        XCTAssertTrue(versionAtLeast("8.10.0", "8.9.9"))
        XCTAssertFalse(versionAtLeast("8.0.12", "8.1.0"))
        XCTAssertFalse(versionAtLeast("garbage", "8.1.0"))
    }
}
