// Output-route reporting (#gnomon-voice-io): the default output device, its
// transport and (built-in) data source, classified by RouteMath. RouteWatch
// listens for a new default output device and for a data-source flip on it
// (headphone jack in or out) and calls back on the main queue.

import CoreAudio
import Foundation
import VoiceIOCore

struct OutputRoute: Equatable {
    let deviceId: AudioObjectID
    let name: String
    let transport: String?
    let dataSource: String?
    let kind: RouteKind

    var json: [String: Any] {
        ["device": name, "transport": transport ?? NSNull(), "dataSource": dataSource ?? NSNull(), "kind": kind.rawValue]
    }

    static func current() -> OutputRoute {
        guard let dev = defaultOutputDevice() else {
            return OutputRoute(deviceId: 0, name: "(none)", transport: nil, dataSource: nil, kind: .unknown)
        }
        let transport = uint32Prop(dev, kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal).map(RouteMath.fourCC)
        let ds = uint32Prop(dev, kAudioDevicePropertyDataSource, kAudioDevicePropertyScopeOutput).map(RouteMath.fourCC)
        return OutputRoute(deviceId: dev, name: stringProp(dev, kAudioObjectPropertyName) ?? "(unnamed)", transport: transport, dataSource: ds, kind: RouteMath.classify(transport: transport, dataSource: ds))
    }

    static func defaultOutputDevice() -> AudioObjectID? {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var dev = AudioObjectID(0)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let st = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev)
        return st == noErr && dev != 0 ? dev : nil
    }

    static func uint32Prop(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope) -> UInt32? {
        var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectHasProperty(obj, &addr) else { return nil }
        var v = UInt32(0)
        var size = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &v) == noErr ? v : nil
    }

    static func stringProp(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String? {
        var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var cf: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &cf) == noErr, let s = cf?.takeRetainedValue() else { return nil }
        return s as String
    }
}

final class RouteWatch {
    private let onChange: () -> Void
    private var watchedDevice: AudioObjectID = 0
    private lazy var block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.changed() }
    private var defaultAddr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    private var dataSourceAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDataSource, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)

    init(onChange: @escaping () -> Void) {
        self.onChange = onChange
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &defaultAddr, DispatchQueue.main, block)
        watchDevice()
    }

    private func watchDevice() {
        if watchedDevice != 0 {
            AudioObjectRemovePropertyListenerBlock(watchedDevice, &dataSourceAddr, DispatchQueue.main, block)
            watchedDevice = 0
        }
        guard let dev = OutputRoute.defaultOutputDevice(), AudioObjectHasProperty(dev, &dataSourceAddr) else { return }
        if AudioObjectAddPropertyListenerBlock(dev, &dataSourceAddr, DispatchQueue.main, block) == noErr { watchedDevice = dev }
    }

    private func changed() {
        watchDevice()
        onChange()
    }
}
