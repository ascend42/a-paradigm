import XCTest
@testable import VoiceIOCore

final class RestartGovernorTests: XCTestCase {
    private let s: UInt64 = 1_000_000_000

    func testAllowsUpToTheLimitThenRefuses() {
        var g = RestartGovernor(limit: 3, windowNs: 15 * s)
        XCTAssertTrue(g.allow(nowNs: 1 * s))
        XCTAssertTrue(g.allow(nowNs: 2 * s))
        XCTAssertTrue(g.allow(nowNs: 3 * s))
        // the 2026-10-23 loop: a fourth stop inside the window is a device that keeps changing under us
        XCTAssertFalse(g.allow(nowNs: 4 * s))
        XCTAssertFalse(g.allow(nowNs: 5 * s))
    }

    func testOldRecoveriesLeaveTheWindow() {
        var g = RestartGovernor(limit: 2, windowNs: 10 * s)
        XCTAssertTrue(g.allow(nowNs: 1 * s))
        XCTAssertTrue(g.allow(nowNs: 2 * s))
        XCTAssertFalse(g.allow(nowNs: 5 * s))
        // a route change much later (the founder plugs in headphones an hour on) is allowed again
        XCTAssertTrue(g.allow(nowNs: 12 * s))
        XCTAssertEqual(g.recent, [12 * s])
    }

    func testRefusalsAreNotRecorded() {
        var g = RestartGovernor(limit: 1, windowNs: 10 * s)
        XCTAssertTrue(g.allow(nowNs: 1 * s))
        XCTAssertFalse(g.allow(nowNs: 2 * s))
        XCTAssertFalse(g.allow(nowNs: 9 * s))
        XCTAssertTrue(g.allow(nowNs: 11 * s))
    }

    func testResetStartsANewBudget() {
        var g = RestartGovernor(limit: 1, windowNs: 10 * s)
        XCTAssertTrue(g.allow(nowNs: 1 * s))
        XCTAssertFalse(g.allow(nowNs: 2 * s))
        g.reset()
        XCTAssertTrue(g.allow(nowNs: 3 * s))
    }

    func testZeroLimitNeverRecovers() {
        var g = RestartGovernor(limit: 0, windowNs: 10 * s)
        XCTAssertFalse(g.allow(nowNs: 1 * s))
    }

    func testDefaults() {
        let g = RestartGovernor()
        XCTAssertEqual(g.limit, 3)
        XCTAssertEqual(g.windowNs, 15 * s)
        XCTAssertGreaterThan(RestartGovernor.settleMs, 0)
    }
}
