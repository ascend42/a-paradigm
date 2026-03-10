// AXDispatchTarget.swift — #dispatch-target
// macOS AX-based text injection to Claude Code terminal windows.
// Primary: AX setValue. Fallback: clipboard + Cmd+V via CGEvent.

import AppKit
import ApplicationServices

/// macOS implementation of text dispatch using Accessibility API.
final class AXDispatchTarget: DispatchTargetProtocol {

    func sendText(_ text: String, to instance: ClaudeCodeInstance, submit: Bool) async throws {
        ConductorLog.component("dispatch-target")
            .info("Dispatching \(text.count) chars to \(instance.title)")

        // Try AX text injection first
        do {
            try injectViaAccessibility(text: text, pid: instance.processID, submit: submit)
            ConductorLog.signal("buffer-dispatched")
                .info("Dispatched via AX to \(instance.title)")
            return
        } catch {
            ConductorLog.component("dispatch-target")
                .info("AX injection failed, trying clipboard fallback: \(error.localizedDescription)")
        }

        // Fallback: clipboard + Cmd+V
        do {
            try await injectViaClipboard(text: text, instance: instance, submit: submit)
            ConductorLog.signal("buffer-dispatched")
                .info("Dispatched via clipboard to \(instance.title)")
        } catch {
            throw DispatchError.clipboardFallbackFailed
        }
    }

    // MARK: - AX Injection

    private func injectViaAccessibility(text: String, pid: pid_t, submit: Bool) throws {
        let app = AXUIElementCreateApplication(pid)

        // Find the focused/text element
        var focusedElement: AnyObject?
        let focusResult = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focusedElement)

        guard focusResult == .success, let element = focusedElement else {
            throw DispatchError.textInjectionFailed("Could not find focused element")
        }

        let axElement = element as! AXUIElement

        // Try to set value directly
        let payload = submit ? text + "\n" : text
        let setResult = AXUIElementSetAttributeValue(axElement, kAXValueAttribute as CFString, payload as CFString)

        if setResult != .success {
            throw DispatchError.textInjectionFailed("AXUIElementSetAttributeValue returned \(setResult.rawValue)")
        }
    }

    // MARK: - Clipboard Fallback

    private func injectViaClipboard(text: String, instance: ClaudeCodeInstance, submit: Bool) async throws {
        // Save current clipboard
        let pasteboard = NSPasteboard.general
        let previousContents = pasteboard.string(forType: .string)

        // Set our text
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)

        // Bring the target window to front
        let app = NSRunningApplication(processIdentifier: instance.processID)
        app?.activate(options: [.activateIgnoringOtherApps])

        // Small delay for focus to settle
        try await Task.sleep(for: .milliseconds(100))

        // Send Cmd+V
        sendKeyEvent(keyCode: 9, flags: .maskCommand) // 9 = 'v'

        if submit {
            try await Task.sleep(for: .milliseconds(50))
            sendKeyEvent(keyCode: 36, flags: []) // 36 = Return
        }

        // Restore previous clipboard after a delay
        if let previous = previousContents {
            try await Task.sleep(for: .milliseconds(200))
            pasteboard.clearContents()
            pasteboard.setString(previous, forType: .string)
        }
    }

    private func sendKeyEvent(keyCode: CGKeyCode, flags: CGEventFlags) {
        let source = CGEventSource(stateID: .hidSystemState)
        if let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
           let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) {
            keyDown.flags = flags
            keyUp.flags = flags
            keyDown.post(tap: .cghidEventTap)
            keyUp.post(tap: .cghidEventTap)
        }
    }
}
