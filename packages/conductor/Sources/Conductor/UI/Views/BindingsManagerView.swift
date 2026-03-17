// BindingsManagerView.swift — #bindings-manager
// Settings tab for managing all input→action bindings.
// Composed from sub-views in UI/Views/Bindings/.

import SwiftUI

struct BindingsManagerView: View {
    @ObservedObject var actionRegistry: ActionRegistry
    @ObservedObject var voiceCommandRegistry: VoiceCommandRegistry
    @ObservedObject var customGestureClassifier: CustomGestureClassifier
    var eyebrowBindingRegistry: EyebrowBindingRegistry?
    var hotKeyBindingRegistry: HotKeyBindingRegistry?

    @State private var showGestureRecorder = false

    var body: some View {
        Form {
            CustomGestureBindingsView(
                customGestureClassifier: customGestureClassifier,
                showGestureRecorder: $showGestureRecorder
            )

            VoiceCommandBindingsView(
                voiceCommandRegistry: voiceCommandRegistry
            )

            BuiltInGestureBindingsView(
                actionRegistry: actionRegistry
            )

            if let eyebrowRegistry = eyebrowBindingRegistry {
                EyebrowBindingsView(
                    eyebrowBindingRegistry: eyebrowRegistry
                )
            }

            if let hotKeyRegistry = hotKeyBindingRegistry {
                HotkeyBindingsView(
                    hotKeyBindingRegistry: hotKeyRegistry
                )
            }
        }
    }
}
