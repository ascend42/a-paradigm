// ActionPickerViews.swift — #action-picker-views
// Shared action picker views and gesture display name helper for binding views.

import SwiftUI

/// Action picker (all actions, no "None" option).
@ViewBuilder
func bindingActionPicker(selection: Binding<String>) -> some View {
    Picker("", selection: selection) {
        Text("Send").tag("send")
        Text("Undo").tag("undo")
        Text("Redo").tag("redo")
        Text("Voice Start").tag("voiceStart")
        Text("Voice Stop").tag("voiceStop")
        Text("Voice Arm").tag("voiceArm")
        Text("Toggle Video").tag("toggleVideo")
        Text("Toggle Voice").tag("toggleVoice")
        Text("Mute Video").tag("muteVideo")
        Text("Mute Voice").tag("muteVoice")
        Text("Delete Char").tag("deleteChar")
        Text("Delete Word").tag("deleteWord")
    }
    .labelsHidden()
}

/// Action picker with "None" as the first option.
@ViewBuilder
func bindingActionPickerWithNone(selection: Binding<String>) -> some View {
    Picker("", selection: selection) {
        Text("None").tag("none")
        Text("Send").tag("send")
        Text("Undo").tag("undo")
        Text("Redo").tag("redo")
        Text("Voice Start").tag("voiceStart")
        Text("Voice Stop").tag("voiceStop")
        Text("Voice Arm").tag("voiceArm")
        Text("Toggle Video").tag("toggleVideo")
        Text("Toggle Voice").tag("toggleVoice")
        Text("Mute Video").tag("muteVideo")
        Text("Mute Voice").tag("muteVoice")
    }
    .labelsHidden()
}

/// Human-readable name for built-in gesture identifiers.
func gestureDisplayName(_ name: String) -> String {
    switch name {
    case "pinch": return "Pinch"
    case "fist": return "Fist"
    case "open_after_fist": return "Open Palm"
    case "twoFingerTap": return "Two-Finger Tap"
    case "swipeLeft": return "Swipe Left"
    case "swipeRight": return "Swipe Right"
    default: return name
    }
}
