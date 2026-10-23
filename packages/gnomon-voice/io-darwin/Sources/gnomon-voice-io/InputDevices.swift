// Input devices of #gnomon-voice-io (founder request 2026-10-23): the CoreAudio devices that can capture, the system
// default input, and a watch that calls back on the main queue when the device list or the default input changes.
// Voice processing's own aggregate devices are hidden (they are ours, not the human's).

import CoreAudio
import Foundation
import VoiceIOCore

struct InputDevice: Equatable {
    let id: AudioObjectID
    let uid: String
    let name: String
    let transport: String?
    let sampleRate: Int?

    var json: [String: Any] {
        ["id": uid, "name": name, "transport": InputDevice.transportWord(transport) ?? NSNull(), "sampleRate": sampleRate ?? NSNull()]
    }

    /// CoreAudio's transport four-char code → a plain word for the GUI
    static func transportWord(_ t: String?) -> String? {
        switch t {
        case nil: return nil
        case "bltn": return "built-in"
        case "blue", "blea": return "bluetooth"
        case "usb ": return "usb"
        case "hdmi": return "hdmi"
        case "dprt": return "displayport"
        case "virt": return "virtual"
        case "grup": return "aggregate"
        case "airp": return "airplay"
        case "thun": return "thunderbolt"
        case "pci ": return "pci"
        case "fwir": return "firewire"
        default: return "other"
        }
    }
}

enum InputDevices {
    static func all() -> [InputDevice] {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(0)
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
        return ids.compactMap(device).filter { !hidden($0) }
    }

    static func device(_ id: AudioObjectID) -> InputDevice? {
        guard inputChannels(id) > 0, let uid = OutputRoute.stringProp(id, kAudioDevicePropertyDeviceUID) else { return nil }
        let transport = OutputRoute.uint32Prop(id, kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal).map(RouteMath.fourCC)
        return InputDevice(id: id, uid: uid, name: OutputRoute.stringProp(id, kAudioObjectPropertyName) ?? "(unnamed)", transport: transport, sampleRate: nominalRate(id))
    }

    /// voice processing's and CoreAudio's private aggregates are not inputs the human chose
    static func hidden(_ d: InputDevice) -> Bool {
        d.name.hasPrefix("VPAUAggregateAudioDevice") || d.name.hasPrefix("CADefaultDeviceAggregate") || d.uid.hasPrefix("VPAUAggregateAudioDevice") || d.uid.hasPrefix("CADefaultDeviceAggregate")
    }

    static func defaultInput() -> InputDevice? {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var dev = AudioObjectID(0)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev) == noErr, dev != 0 else { return nil }
        return device(dev)
    }

    static func inputChannels(_ id: AudioObjectID) -> Int {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(0)
        guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr, size > 0 else { return 0 }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, raw) == noErr else { return 0 }
        let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
        return list.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    static func nominalRate(_ id: AudioObjectID) -> Int? {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyNominalSampleRate, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var v = Float64(0)
        var size = UInt32(MemoryLayout<Float64>.size)
        guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &v) == noErr, v > 0 else { return nil }
        return Int(v.rounded())
    }

    /// The device to capture from for `preferred` (a UID, or nil: the system default), and whether a chosen one is missing.
    static func resolve(preferred: String?) -> (device: InputDevice?, missing: Bool, inputs: [InputDevice]) {
        let inputs = all()
        let r = InputChoice.resolve(preferred: preferred, available: inputs.map(\.uid), systemDefault: defaultInput()?.uid)
        return (inputs.first { $0.uid == r.uid }, r.missing, inputs)
    }
}

/// Calls back (main queue) when a device appears or goes, or the default input changes.
final class InputWatch {
    private let onChange: () -> Void
    private lazy var block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.onChange() }
    private var devicesAddr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    private var defaultAddr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)

    init(onChange: @escaping () -> Void) {
        self.onChange = onChange
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &devicesAddr, DispatchQueue.main, block)
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &defaultAddr, DispatchQueue.main, block)
    }
}
