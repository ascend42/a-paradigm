// gnomon-helper 1.7.0 unit tests (TD-2026-10-20-086 F4/F5): the cached-unlock bounds. No Secure Enclave, no
// prompt: the store is driven directly with spy contexts (SpyContext, ArmCustodyTests.swift).

import Foundation
import XCTest
@testable import gnomon_helper

final class UnlockBoundsTests: XCTestCase {
    func testBoundsAreTwelveHoursAnd512WithNoSeparateIdle() {
        XCTAssertEqual(gnomonHelperVersion, "1.11.0")
        XCTAssertEqual(Bounds.unlockAbsoluteSeconds, 12 * 60 * 60)
        XCTAssertEqual(Bounds.unlockIdleSeconds, Bounds.unlockAbsoluteSeconds)
        XCTAssertEqual(Bounds.maxSignaturesPerUnlock, 512)
        let r = Bounds.unlockBoundsReply
        XCTAssertEqual(r["idleSeconds"] as? Int, 12 * 60 * 60)
        XCTAssertEqual(r["absoluteSeconds"] as? Int, 12 * 60 * 60)
        XCTAssertEqual(r["maxSignatures"] as? Int, 512)
    }

    func testCapEndsTheUnlockAt512Signatures() {
        let u = Unlocks()
        let ctx = SpyContext()
        XCTAssertTrue(u.put("udev:0123456789abcdef0123456789abcdef01234567", gen: "test0001", ctx: ctx))
        XCTAssertNotNil(u.use("udev:0123456789abcdef0123456789abcdef01234567", gen: "test0001", signatures: 511))
        XCTAssertNotNil(u.use("udev:0123456789abcdef0123456789abcdef01234567", gen: "test0001", signatures: 1))
        XCTAssertNil(u.use("udev:0123456789abcdef0123456789abcdef01234567", gen: "test0001", signatures: 1))
        XCTAssertTrue(ctx.invalidated)
    }

    func testDeviceKeyIsAValidConnIdAndConnCloseOfAnotherIdLeavesIt() {
        // F5: the kernel holds a device's unlock under `udev:<40 hex>`; closing a connection never names that key
        XCTAssertTrue(validConnId("udev:0123456789abcdef0123456789abcdef01234567"))
        let u = Unlocks()
        XCTAssertTrue(u.put("udev:0123456789abcdef0123456789abcdef01234567", gen: "test0001", ctx: SpyContext()))
        XCTAssertFalse(u.drop("conn:01HZZZZZZZZZZZZZZZZZZZZZZA"))
        XCTAssertNotNil(u.use("udev:0123456789abcdef0123456789abcdef01234567", gen: "test0001", signatures: 1))
    }

    func testDropAllEndsTheDeviceUnlock() {
        // the session observer (lock, sleep, user switch) calls dropAll: a device unlock dies with it
        let u = Unlocks()
        let ctx = SpyContext()
        XCTAssertTrue(u.put("udev:0123456789abcdef0123456789abcdef01234567", gen: "test0001", ctx: ctx))
        XCTAssertEqual(u.dropAll(), 1)
        XCTAssertTrue(ctx.invalidated)
        XCTAssertNil(u.use("udev:0123456789abcdef0123456789abcdef01234567", gen: "test0001", signatures: 1))
    }
}
