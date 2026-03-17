// HotKeyBindingRegistryTests.swift
// Tests for #hotkey-binding-registry — defaults, CRUD, serialization.

import XCTest
@testable import Conductor

@MainActor
final class HotKeyBindingRegistryTests: XCTestCase {

    func testDefaultBindings() {
        let registry = HotKeyBindingRegistry()
        // Should have at least the default video + voice toggle bindings
        XCTAssertFalse(registry.bindings.isEmpty)
        XCTAssertEqual(registry.bindings[.toggleVideo], .toggleVideo)
        XCTAssertEqual(registry.bindings[.toggleVoice], .toggleVoice)
    }

    func testSetBinding() {
        let registry = HotKeyBindingRegistry()
        let binding = HotKeyBinding(keyCode: 99, modifiers: .command)
        registry.setBinding(binding, action: .send)

        XCTAssertEqual(registry.bindings[binding], .send)
    }

    func testRemoveBinding() {
        let registry = HotKeyBindingRegistry()
        let binding = HotKeyBinding(keyCode: 99, modifiers: .command)
        registry.setBinding(binding, action: .send)
        registry.removeBinding(binding)

        XCTAssertNil(registry.bindings[binding])
    }

    func testResetToDefaults() {
        let registry = HotKeyBindingRegistry()
        let custom = HotKeyBinding(keyCode: 99, modifiers: .command)
        registry.setBinding(custom, action: .send)
        registry.resetToDefaults()

        XCTAssertNil(registry.bindings[custom])
        XCTAssertEqual(registry.bindings.count, HotKeyBindingRegistry.defaultBindings.count)
    }

    func testBindingCount() {
        let registry = HotKeyBindingRegistry()
        let initial = registry.bindings.count
        let custom = HotKeyBinding(keyCode: 42, modifiers: [.command, .shift])
        registry.setBinding(custom, action: .undo)

        XCTAssertEqual(registry.bindings.count, initial + 1)
    }
}
