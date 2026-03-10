// HotKeyManager.swift — #hotkey-manager
// Global hotkey registration using CGEvent tap.

import AppKit
import Carbon

/// Manages global keyboard shortcuts for Conductor.
@MainActor
final class HotKeyManager: ObservableObject {
    /// Registered hotkey callbacks.
    private var handlers: [HotKeyBinding: () -> Void] = [:]

    /// Whether the event tap is installed.
    @Published private(set) var isActive: Bool = false

    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    // MARK: - Registration

    /// Register a global hotkey.
    func register(_ binding: HotKeyBinding, handler: @escaping () -> Void) {
        handlers[binding] = handler
        ConductorLog.component("hotkey-manager")
            .info("Registered hotkey: \(binding.description)")

        if !isActive {
            installEventTap()
        }
    }

    /// Unregister a global hotkey.
    func unregister(_ binding: HotKeyBinding) {
        handlers.removeValue(forKey: binding)
    }

    /// Remove all hotkeys.
    func unregisterAll() {
        handlers.removeAll()
        removeEventTap()
    }

    // MARK: - Event Tap

    private func installEventTap() {
        let mask: CGEventMask = (1 << CGEventType.keyDown.rawValue)

        let callback: CGEventTapCallBack = { proxy, type, event, refcon in
            guard let refcon = refcon else { return Unmanaged.passRetained(event) }
            let manager = Unmanaged<HotKeyManager>.fromOpaque(refcon).takeUnretainedValue()

            let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
            let flags = event.flags

            let binding = HotKeyBinding(
                keyCode: UInt16(keyCode),
                modifiers: HotKeyModifiers(from: flags)
            )

            if let handler = manager.handlers[binding] {
                DispatchQueue.main.async {
                    handler()
                }
                // Consume the event so it doesn't reach other apps
                return nil
            }

            return Unmanaged.passRetained(event)
        }

        let refcon = Unmanaged.passUnretained(self).toOpaque()

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: callback,
            userInfo: refcon
        ) else {
            ConductorLog.component("hotkey-manager")
                .error("Failed to create event tap — check Accessibility permissions")
            return
        }

        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)

        self.eventTap = tap
        self.runLoopSource = source
        isActive = true

        ConductorLog.component("hotkey-manager").info("Global hotkey event tap installed")
    }

    private func removeEventTap() {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
        if let source = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, .commonModes)
        }
        eventTap = nil
        runLoopSource = nil
        isActive = false
    }

    deinit {
        // Cannot call removeEventTap() in deinit for MainActor class,
        // but the tap will be invalidated when the CFMachPort is deallocated.
    }
}

// MARK: - Types

struct HotKeyBinding: Hashable, CustomStringConvertible {
    let keyCode: UInt16
    let modifiers: HotKeyModifiers

    var description: String {
        var parts: [String] = []
        if modifiers.contains(.command) { parts.append("Cmd") }
        if modifiers.contains(.option) { parts.append("Opt") }
        if modifiers.contains(.control) { parts.append("Ctrl") }
        if modifiers.contains(.shift) { parts.append("Shift") }
        parts.append("Key(\(keyCode))")
        return parts.joined(separator: "+")
    }
}

struct HotKeyModifiers: OptionSet, Hashable {
    let rawValue: UInt32

    static let command = HotKeyModifiers(rawValue: 1 << 0)
    static let option  = HotKeyModifiers(rawValue: 1 << 1)
    static let control = HotKeyModifiers(rawValue: 1 << 2)
    static let shift   = HotKeyModifiers(rawValue: 1 << 3)

    init(rawValue: UInt32) {
        self.rawValue = rawValue
    }

    init(from flags: CGEventFlags) {
        var mods = HotKeyModifiers()
        if flags.contains(.maskCommand) { mods.insert(.command) }
        if flags.contains(.maskAlternate) { mods.insert(.option) }
        if flags.contains(.maskControl) { mods.insert(.control) }
        if flags.contains(.maskShift) { mods.insert(.shift) }
        self = mods
    }
}

// MARK: - Common Hotkeys

extension HotKeyBinding {
    /// Cmd+Shift+C — Toggle Conductor panel
    static let togglePanel = HotKeyBinding(keyCode: 8, modifiers: [.command, .shift])

    /// Cmd+1–4 — Window layouts
    static let layoutFocused = HotKeyBinding(keyCode: 18, modifiers: .command)   // Cmd+1
    static let layoutSideBySide = HotKeyBinding(keyCode: 19, modifiers: .command) // Cmd+2
    static let layoutThreeUp = HotKeyBinding(keyCode: 20, modifiers: .command)    // Cmd+3
    static let layoutGrid = HotKeyBinding(keyCode: 21, modifiers: .command)       // Cmd+4

    /// F5 — Push to talk
    static let pushToTalk = HotKeyBinding(keyCode: 96, modifiers: [])
}
