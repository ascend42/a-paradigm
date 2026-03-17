// BindingsDecompositionTests.swift
// Compile-check test verifying all extracted binding sub-views instantiate.

import XCTest
@testable import Conductor

@MainActor
final class BindingsDecompositionTests: XCTestCase {

    func testSubViewsInstantiate() {
        // Verify all extracted types exist and can be referenced.
        // This is primarily a compile-time check — if any sub-view was
        // incorrectly extracted, this test file won't compile.

        let _actionRegistry = ActionRegistry()
        let _voiceRegistry = VoiceCommandRegistry()
        let _customClassifier = CustomGestureClassifier()
        let _eyebrowRegistry = EyebrowBindingRegistry()
        let _hotKeyRegistry = HotKeyBindingRegistry()

        // Verify the composed BindingsManagerView accepts all sub-view dependencies
        _ = BindingsManagerView(
            actionRegistry: _actionRegistry,
            voiceCommandRegistry: _voiceRegistry,
            customGestureClassifier: _customClassifier,
            eyebrowBindingRegistry: _eyebrowRegistry,
            hotKeyBindingRegistry: _hotKeyRegistry
        )

        // Verify free functions compile
        _ = gestureDisplayName("pinch")
    }
}
