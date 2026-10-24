// Audio engine of #gnomon-voice-io. One AVAudioEngine at a time:
//
//   mic on   DUPLEX engine: inputNode with voice processing (VoiceProcessingIO,
//            AEC) + a player node into the same engine's mixer, so the echo
//            canceller has the TTS as its reference. A tap converts channel 0 to
//            16 kHz mono Int16 and hands it to onCapture; a LevelMeter gives
//            ~15 Hz RMS / peak readings to onLevel.
//   mic off  no input at all: the engine is stopped and released (the macOS
//            orange dot goes away). TTS that arrives while the mic is off plays
//            through an OUTPUT-ONLY engine that never touches inputNode.
//
// Switching between the two (mic.on / mic.off, an engine configuration change)
// drops queued TTS and reports playback.end{reason}. Everything except the tap
// runs on the main queue.

import AVFoundation
import Foundation
import VoiceIOCore

final class AudioCore {
    static let captureRate: Double = 16_000
    static let playRate: Double = 48_000

    // callbacks (onCapture / onLevel run on the tap thread; the rest on main)
    var onCapture: ((UInt64, [Int16]) -> Void)?
    var onLevel: ((Double, Double) -> Void)?
    var onPlayback: ((String, [String: Any]) -> Void)?
    /// engine {what: restarted | failed | released, reason?} (main queue)
    var onEngineRestart: ((String, String?) -> Void)?

    private(set) var micOn = false
    private(set) var voiceProcessing = false
    /// the human's input choice (a device UID) or nil: follow the system default (InputDevices.swift)
    var preferredInput: String?
    /// the input the running mic captures from, and whether a chosen device is missing (set at mic start)
    private(set) var currentInput: InputDevice?
    private(set) var inputMissing = false
    private var wantVoiceProcessing = true
    private let tapLock = NSLock()
    private var tapGen = 0
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var duplex = false
    private var configObserver: NSObjectProtocol?
    /// the pending in-place recovery after a configuration change, and its budget (Recovery.swift)
    private var recovery: DispatchWorkItem?
    private var governor = RestartGovernor()

    private let playFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: AudioCore.playRate, channels: 1, interleaved: false)!
    private let captureFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: AudioCore.captureRate, channels: 1, interleaved: false)!
    private var playConverters: [UInt32: AVAudioConverter] = [:]

    // playback bookkeeping (main queue)
    private var generation = 0
    private var pending = 0
    private var playing = false
    private var utteranceEnded = false
    private var samplesQueued = 0

    // MARK: permission

    static var permission: String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "granted"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "undetermined"
        @unknown default: return "unknown"
        }
    }

    /// Asks once (the TCC prompt names the responsible app); calls back on main.
    static func requestPermission(_ done: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: done(true)
        case .notDetermined: AVCaptureDevice.requestAccess(for: .audio) { ok in DispatchQueue.main.async { done(ok) } }
        default: done(false)
        }
    }

    // MARK: mic

    /// Starts the duplex engine. `voiceProcessing: false` exists only for probe P7's raw-leak phase.
    func startMic(voiceProcessing wantVP: Bool = true) throws {
        if micOn { return }
        teardown(reason: "mic-switch")
        governor.reset()
        wantVoiceProcessing = wantVP
        let e = AVAudioEngine()
        let input = e.inputNode
        var vp = false
        if wantVP {
            do {
                try input.setVoiceProcessingEnabled(true)
                vp = input.isVoiceProcessingEnabled
                // do not duck the founder's other audio more than the minimum
                input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
            } catch {
                diag("voice processing could not be enabled: \(error.localizedDescription)")
            }
        }
        // the human's input choice: a chosen, connected device is selected on the input unit; otherwise the
        // engine follows the system default (and a chosen device that is absent is reported missing)
        let pick = InputDevices.resolve(preferred: preferredInput)
        currentInput = pick.device
        inputMissing = pick.missing
        if let d = pick.device, preferredInput != nil, d.uid != InputDevices.defaultInput()?.uid, let au = input.audioUnit {
            var dev = d.id
            let st = AudioUnitSetProperty(au, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &dev, UInt32(MemoryLayout<AudioObjectID>.size))
            if st != noErr {
                diag("could not select input \(d.name) (OSStatus \(st)); using the system default")
                currentInput = InputDevices.defaultInput()
            }
        }
        try armTap(e)
        let p = AVAudioPlayerNode()
        do { try startWithPlayer(e, p) } catch {
            input.removeTap(onBus: 0)
            throw error
        }
        install(engine: e, player: p, duplex: true)
        micOn = true
        voiceProcessing = vp
    }

    /// (Re)installs the capture tap for the input node's CURRENT format: channel 0 → 16 kHz mono Int16 →
    /// onCapture, plus the level meter. Called at mic start and again after a configuration change, when
    /// the device may run at another rate (a Bluetooth headset's call profile: 24 kHz).
    private func armTap(_ e: AVAudioEngine) throws {
        let input = e.inputNode
        input.removeTap(onBus: 0)
        let inFmt = input.outputFormat(forBus: 0)
        guard inFmt.sampleRate > 0, inFmt.channelCount > 0 else { throw AudioError.noInput }
        guard let monoIn = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: inFmt.sampleRate, channels: 1, interleaved: false),
              let conv = AVAudioConverter(from: monoIn, to: captureFormat) else { throw AudioError.converter }
        tapLock.lock()
        tapGen += 1
        let myGen = tapGen
        tapLock.unlock()
        var meter = LevelMeter(sampleRate: Int(AudioCore.captureRate), hz: 15)
        let outFmt = captureFormat
        input.installTap(onBus: 0, bufferSize: 1024, format: inFmt) { [weak self] buf, when in
            guard let self, let src = buf.floatChannelData, buf.frameLength > 0 else { return }
            let frames = buf.frameLength
            guard let mono = AVAudioPCMBuffer(pcmFormat: monoIn, frameCapacity: frames) else { return }
            memcpy(mono.floatChannelData![0], src[0], Int(frames) * MemoryLayout<Float>.size)
            mono.frameLength = frames
            let cap = AVAudioFrameCount(Double(frames) * AudioCore.captureRate / monoIn.sampleRate) + 64
            guard let out = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: cap) else { return }
            var given = false
            var err: NSError?
            _ = conv.convert(to: out, error: &err) { _, status in
                if given { status.pointee = .noDataNow; return nil }
                given = true
                status.pointee = .haveData
                return mono
            }
            guard err == nil, out.frameLength > 0, let ch = out.int16ChannelData else { return }
            let samples = Array(UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength)))
            let hostNs = when.isHostTimeValid ? Clock.ns(fromHost: when.hostTime) : Clock.nowNs()
            // Aegis L2: a tap callback in flight when the mic goes off emits nothing. teardown bumps
            // tapGen under this lock BEFORE the mic:false event is queued, and the emit is non-blocking.
            self.tapLock.lock()
            defer { self.tapLock.unlock() }
            guard self.tapGen == myGen else { return }
            self.onCapture?(hostNs, samples)
            for r in meter.feed(samples) { self.onLevel?(r.rms, r.peak) }
        }
    }

    /// Starts `e`, attaching the player only AFTER the start: with voice processing on, macOS (tested on
    /// MacBook Pro mic + speakers, 2026-10-19) fails `start()` with -10875 whenever any player node is
    /// already connected to the main mixer, whatever its format. A recovery detaches it first.
    private func startWithPlayer(_ e: AVAudioEngine, _ p: AVAudioPlayerNode) throws {
        if p.engine != nil {
            e.disconnectNodeOutput(p)
            e.detach(p)
        }
        e.prepare()
        do { try e.start() } catch { throw AudioError.start(error.localizedDescription) }
        e.attach(p)
        e.connect(p, to: e.mainMixerNode, format: playFormat)
        if !e.isRunning {
            do { try e.start() } catch { throw AudioError.start(error.localizedDescription) }
        }
    }

    func stopMic() {
        guard micOn else { return }
        teardown(reason: "mic-switch")
    }

    /// The input choice or the devices changed: when the mic is on and should now capture from another device, move
    /// it there (a deliberate switch: a new engine). Returns whether the mic moved.
    @discardableResult
    func followInputChoice() throws -> Bool {
        guard micOn else { return false }
        let pick = InputDevices.resolve(preferred: preferredInput)
        if pick.device?.uid == currentInput?.uid {
            inputMissing = pick.missing
            return false
        }
        let vp = wantVoiceProcessing
        teardown(reason: "mic-switch")
        try startMic(voiceProcessing: vp)
        return true
    }

    // MARK: playback

    /// Queues mono Int16 TTS at `rate`. Plays through the duplex engine when the
    /// mic is on (AEC reference), otherwise through an output-only engine.
    func enqueue(rate: UInt32, samples: [Int16]) throws {
        if engine == nil { try startOutputOnly() }
        guard let p = player else { throw AudioError.noEngine }
        guard let buf = convertForPlayback(rate: rate, samples: samples, flush: false) else { return }
        schedule(buf, on: p)
    }

    /// The current utterance is complete: flush every resampler's tail.
    func endUtterance() {
        utteranceEnded = true
        guard let p = player else { return }
        for rate in playConverters.keys.sorted() {
            if let buf = convertForPlayback(rate: rate, samples: [], flush: true) { schedule(buf, on: p) }
        }
        playConverters.removeAll()
        if pending == 0, playing { finishPlayback(reason: "drained") }
    }

    /// Barge-in: drop everything queued now.
    func stopPlayback(reason: String = "stopped") {
        generation += 1
        player?.stop()
        playConverters.removeAll()
        pending = 0
        if playing { finishPlayback(reason: reason) }
    }

    var isPlaying: Bool { playing }

    var status: [String: Any] {
        ["mic": micOn, "voiceProcessing": voiceProcessing, "playing": playing, "engine": engine == nil ? "none" : (duplex ? "duplex" : "output")]
    }

    // MARK: internals

    private func startOutputOnly() throws {
        let e = AVAudioEngine() // never touches inputNode: no mic, no orange dot
        let p = AVAudioPlayerNode()
        e.attach(p)
        e.connect(p, to: e.mainMixerNode, format: playFormat)
        e.prepare()
        do { try e.start() } catch { throw AudioError.start(error.localizedDescription) }
        install(engine: e, player: p, duplex: false)
    }

    private func install(engine e: AVAudioEngine, player p: AVAudioPlayerNode, duplex d: Bool) {
        engine = e
        player = p
        duplex = d
        configObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: e, queue: .main) { [weak self] _ in
            self?.configurationChanged()
        }
    }

    private func teardown(reason: String) {
        recovery?.cancel()
        recovery = nil
        stopPlayback(reason: reason)
        if let o = configObserver { NotificationCenter.default.removeObserver(o) }
        configObserver = nil
        tapLock.lock()
        tapGen += 1 // no capture or level frame after this point
        tapLock.unlock()
        if let e = engine {
            if duplex { e.inputNode.removeTap(onBus: 0) }
            e.stop()
            if duplex, voiceProcessing { try? e.inputNode.setVoiceProcessingEnabled(false) }
        }
        engine = nil
        player = nil
        duplex = false
        micOn = false
        voiceProcessing = false
        currentInput = nil
        inputMissing = false
    }

    private func configurationChanged() {
        // Our own post-start player attach also posts this notice with the engine still running: nothing to do.
        if let e = engine, e.isRunning { return }
        // The engine stopped itself (a device, rate or route change). Field bug 2026-10-23: a Bluetooth headset
        // switches to its call profile (48 → 24 kHz) a moment after a voice-processing engine starts. Tearing the
        // engine down here turned voice processing off, which gave the headset back its music profile, so the
        // rebuilt engine switched it again: a restart about once a second, the mic indicator flickering and no
        // audio delivered. Now: let the device settle, then recover the SAME engine in place (recover()).
        recovery?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.recover() }
        recovery = w
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(RestartGovernor.settleMs), execute: w)
    }

    private func recover() {
        recovery = nil
        guard let e = engine, !e.isRunning else { return } // gone, or running again on its own
        guard duplex else {
            // output only: TTS was dropped with the stop; the next utterance starts a fresh output engine
            teardown(reason: "route-change")
            onEngineRestart?("released", nil)
            return
        }
        stopPlayback(reason: "route-change")
        guard governor.allow(nowNs: Clock.nowNs()) else {
            teardown(reason: "route-change")
            diag("the audio device kept changing under the mic (\(governor.limit) restarts in \(governor.windowNs / 1_000_000_000) s); the mic is off")
            onEngineRestart?("failed", "restart-loop")
            return
        }
        do {
            guard let p = player else { throw AudioError.noEngine }
            try armTap(e)
            try startWithPlayer(e, p)
            onEngineRestart?("restarted", nil)
        } catch {
            teardown(reason: "route-change")
            diag("mic restart after a configuration change failed: \(error)")
            onEngineRestart?("failed", (error as? AudioError)?.code ?? "engine-start")
        }
    }

    private func convertForPlayback(rate: UInt32, samples: [Int16], flush: Bool) -> AVAudioPCMBuffer? {
        guard let inFmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(rate), channels: 1, interleaved: false) else { return nil }
        let conv: AVAudioConverter
        if let c = playConverters[rate] { conv = c } else {
            guard let c = AVAudioConverter(from: inFmt, to: playFormat) else { return nil }
            playConverters[rate] = c
            conv = c
        }
        var input: AVAudioPCMBuffer?
        if !samples.isEmpty {
            guard let b = AVAudioPCMBuffer(pcmFormat: inFmt, frameCapacity: AVAudioFrameCount(samples.count)) else { return nil }
            let dst = b.floatChannelData![0]
            for (i, s) in samples.enumerated() { dst[i] = Float(s) / 32768 }
            b.frameLength = AVAudioFrameCount(samples.count)
            input = b
        }
        let cap = AVAudioFrameCount(Double(max(samples.count, 256)) * AudioCore.playRate / Double(rate)) + 512
        guard let out = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: cap) else { return nil }
        var given = false
        var err: NSError?
        _ = conv.convert(to: out, error: &err) { _, status in
            if given || input == nil {
                status.pointee = flush ? .endOfStream : .noDataNow
                return nil
            }
            given = true
            status.pointee = .haveData
            return input
        }
        if err != nil || out.frameLength == 0 { return nil }
        return out
    }

    private func schedule(_ buf: AVAudioPCMBuffer, on p: AVAudioPlayerNode) {
        let gen = generation
        pending += 1
        samplesQueued += Int(buf.frameLength)
        p.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }
                self.pending -= 1
                if self.pending == 0, self.playing { self.finishPlayback(reason: "drained") }
            }
        }
        if !playing {
            playing = true
            utteranceEnded = false
            samplesQueued = Int(buf.frameLength)
            p.play()
            let latency = (engine?.outputNode.presentationLatency ?? 0)
            let now = Clock.nowUs()
            onPlayback?("playback.start", ["engine": duplex ? "duplex" : "output", "audibleAtUs": now + UInt64(max(0, latency) * 1_000_000), "outputLatencyUs": Int(latency * 1_000_000)])
        }
    }

    private func finishPlayback(reason: String) {
        playing = false
        let ms = Int(Double(samplesQueued) / AudioCore.playRate * 1000)
        onPlayback?("playback.end", ["reason": reason, "utteranceEnded": utteranceEnded, "queuedMs": ms])
        samplesQueued = 0
    }
}

enum AudioError: Error, CustomStringConvertible {
    case noInput
    case noEngine
    case converter
    case start(String)

    var code: String {
        switch self {
        case .noInput: return "no-input"
        case .noEngine: return "no-engine"
        case .converter: return "converter"
        case .start: return "engine-start"
        }
    }

    var description: String {
        switch self {
        case .noInput: return "no input device"
        case .noEngine: return "no audio engine"
        case .converter: return "no converter for the device format"
        case .start(let m): return "the engine did not start: \(m)"
        }
    }
}
