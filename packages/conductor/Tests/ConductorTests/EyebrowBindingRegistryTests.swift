// EyebrowBindingRegistryTests.swift
// Tests for #eyebrow-binding-registry — CRUD, state machine flag, persistence.

import XCTest
@testable import Conductor

@MainActor
final class EyebrowBindingRegistryTests: XCTestCase {

    /// Clean UserDefaults state before each test.
    override func setUp() {
        super.setUp()
        UserDefaults.standard.removeObject(forKey: "eyebrowBindings")
        UserDefaults.standard.removeObject(forKey: "eyebrowUseStateMachine")
    }

    func testDefaultsEmpty() {
        let registry = EyebrowBindingRegistry()
        XCTAssertTrue(registry.bindings.isEmpty)
        XCTAssertTrue(registry.useStateMachine)
    }

    func testSetBinding() {
        let registry = EyebrowBindingRegistry()
        registry.setBinding(.leftRaise, action: .send)

        XCTAssertEqual(registry.bindings[.leftRaise], .send)
    }

    func testRemoveBinding() {
        let registry = EyebrowBindingRegistry()
        registry.setBinding(.leftRaise, action: .send)
        registry.removeBinding(.leftRaise)

        XCTAssertNil(registry.bindings[.leftRaise])
    }

    func testResetBindings() {
        let registry = EyebrowBindingRegistry()
        registry.setBinding(.leftRaise, action: .send)
        registry.setBinding(.rightRaise, action: .undo)
        registry.useStateMachine = false
        registry.resetBindings()

        XCTAssertTrue(registry.bindings.isEmpty)
        XCTAssertTrue(registry.useStateMachine)
    }

    func testAllEventKinds() {
        let kinds = EyebrowEventKind.allCases
        XCTAssertEqual(kinds.count, 4)
        XCTAssertTrue(kinds.contains(.leftRaise))
        XCTAssertTrue(kinds.contains(.leftLower))
        XCTAssertTrue(kinds.contains(.rightRaise))
        XCTAssertTrue(kinds.contains(.rightLower))
    }

    func testStateMachineFlag() {
        let registry = EyebrowBindingRegistry()
        XCTAssertTrue(registry.useStateMachine)

        registry.useStateMachine = false
        XCTAssertFalse(registry.useStateMachine)
    }
}
