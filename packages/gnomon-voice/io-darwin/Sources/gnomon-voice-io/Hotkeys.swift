// Global hotkeys of #gnomon-voice-io: Carbon RegisterEventHotKey, which gives
// press AND release and needs no Input Monitoring grant (unlike an event tap).
// Events arrive on the main thread (the application event loop). The binary
// only reports them; the controller decides what they mean.

import Carbon.HIToolbox
import Foundation
import VoiceIOCore

final class Hotkeys {
    private(set) var config = HotkeyConfig.defaults
    private var refs: [HotkeyAction: EventHotKeyRef] = [:]
    private var handler: EventHandlerRef?
    private let signature: OSType = 0x676E_7669 // 'gnvi'
    var onHotkey: ((HotkeyAction, String) -> Void)?
    /// actions whose chord the system refused (taken by another app)
    private(set) var failed: [HotkeyAction: OSStatus] = [:]

    init() {
        var types = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
        ]
        let me = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, event, user in
            guard let event, let user else { return OSStatus(eventNotHandledErr) }
            var hk = EventHotKeyID()
            let st = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &hk)
            guard st == noErr else { return st }
            let me = Unmanaged<Hotkeys>.fromOpaque(user).takeUnretainedValue()
            guard hk.signature == me.signature, let action = HotkeyAction(carbonId: hk.id) else { return OSStatus(eventNotHandledErr) }
            me.onHotkey?(action, GetEventKind(event) == UInt32(kEventHotKeyPressed) ? "down" : "up")
            return noErr
        }, 2, &types, me, &handler)
    }

    /// Registers `next` atomically: on any failure the previous set is restored.
    @discardableResult
    func apply(_ next: HotkeyConfig) -> [HotkeyAction: OSStatus] {
        let previous = config
        unregisterAll()
        let errs = register(next)
        if errs.isEmpty {
            config = next
        } else {
            unregisterAll()
            _ = register(previous)
        }
        failed = errs
        return errs
    }

    private func register(_ cfg: HotkeyConfig) -> [HotkeyAction: OSStatus] {
        var errs: [HotkeyAction: OSStatus] = [:]
        for action in HotkeyAction.allCases {
            guard let spec = cfg.bindings[action] else { continue }
            var ref: EventHotKeyRef?
            let st = RegisterEventHotKey(spec.keyCode, spec.modifiers, EventHotKeyID(signature: signature, id: action.carbonId), GetApplicationEventTarget(), 0, &ref)
            if st == noErr, let ref { refs[action] = ref } else { errs[action] = st }
        }
        return errs
    }

    private func unregisterAll() {
        for (_, r) in refs { UnregisterEventHotKey(r) }
        refs.removeAll()
    }
}
