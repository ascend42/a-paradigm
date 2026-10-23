// The serve loop of #gnomon-voice-io: a reader thread decodes framed stdin
// (FrameDecoder) and hands each frame to the main queue, where the audio core,
// the route watch and the hotkeys live. stdin EOF (or a framing error) ends the
// process: the mic stops with it.

import AppKit
import Foundation
import VoiceIOCore

final class Server {
    let audio = AudioCore()
    let hotkeys = Hotkeys()
    let micGate = MicGate(provider: { done in AudioCore.requestPermission(done) }, disclaimAllowed: { Disclaim.micAllowed })
    private var routeWatch: RouteWatch?
    private var inputWatch: InputWatch?
    private var lastRoute: OutputRoute?

    func start() {
        audio.onCapture = { ns, samples in Output.shared.capture(hostTimeNs: ns, samples: samples) }
        audio.onLevel = { rms, peak in Output.shared.event("level", ["rmsDBFS": round1(rms), "peakDBFS": round1(peak)]) }
        audio.onPlayback = { name, fields in Output.shared.event(name, fields) }
        audio.onEngineRestart = { [weak self] what, reason in
            guard let self else { return }
            var fields: [String: Any] = ["what": what, "mic": self.audio.micOn]
            if let reason { fields["reason"] = reason }
            Output.shared.event("engine", fields)
            // the mic stopped for good: say so the way mic.off does, so the controller drops capture state
            if what == "failed" { Output.shared.event("mic", ["on": false, "voiceProcessing": false, "aec": self.aec.rawValue, "transport": self.transport]) }
            self.reportRoute(force: true)
        }
        hotkeys.onHotkey = { action, phase in Output.shared.event("hotkey", ["action": action.rawValue, "phase": phase]) }
        let errs = hotkeys.apply(HotkeyConfig.defaults)
        watchSystem()
        routeWatch = RouteWatch { [weak self] in self?.reportRoute(force: false) }
        // founder request 2026-10-23: a device came or went, or the default input changed: say so, and move the mic
        // to the device it should use now (the chosen one when it is back, else the system default)
        inputWatch = InputWatch { [weak self] in self?.inputsChanged() }
        lastRoute = OutputRoute.current()
        var ready = infoFields()
        if !errs.isEmpty { ready["hotkeyErrors"] = errs.map { "\($0.key.rawValue): OSStatus \($0.value)" }.sorted() }
        Output.shared.event("ready", ready)

        let t = Thread { Server.readLoop() }
        t.name = "gnomon-voice-io.stdin"
        t.start()
    }

    /// TD-2026-10-21-514: screen lock, sleep and user switch turn the mic off (the controller stops capture on the
    /// `system` event; the binary only reports, as for hotkeys).
    private var systemObservers: [NSObjectProtocol] = []
    private func watchSystem() {
        let ws = NSWorkspace.shared.notificationCenter
        let report: (String) -> (Notification) -> Void = { what in { _ in Output.shared.event("system", ["what": what]) } }
        systemObservers.append(ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main, using: report("system-sleep")))
        systemObservers.append(ws.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main, using: report("display-sleep")))
        systemObservers.append(ws.addObserver(forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main, using: report("user-switch")))
        systemObservers.append(DistributedNotificationCenter.default().addObserver(forName: NSNotification.Name("com.apple.screenIsLocked"), object: nil, queue: .main, using: report("screen-lock")))
    }

    private static func readLoop() {
        var decoder = FrameDecoder()
        var buf = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let n = read(STDIN_FILENO, &buf, buf.count)
            if n < 0 && errno == EINTR { continue }
            if n <= 0 { break }
            do {
                let frames = try decoder.push(Data(buf[0..<n]))
                for f in frames { DispatchQueue.main.async { Server.current?.handle(f) } }
            } catch {
                DispatchQueue.main.async {
                    Output.shared.event("error", ["error": "framing", "message": "\(error)"])
                    Server.current?.shutdown(code: 2)
                }
                return
            }
        }
        DispatchQueue.main.async { Server.current?.shutdown(code: 0) }
    }

    static var current: Server?

    func shutdown(code: Int32) {
        audio.stopPlayback(reason: "exit")
        audio.stopMic()
        Output.shared.event("exit", ["code": Int(code)])
        Output.shared.flush()
        exit(code)
    }

    // MARK: frames

    func handle(_ f: Frame) {
        switch f.type {
        case .json:
            do {
                let (id, cmd) = try CommandParser.parse(f.payload)
                run(id: id, cmd)
            } catch let e as CommandError {
                Output.shared.json(CommandParser.errorReply(e))
            } catch {
                Output.shared.json(CommandParser.errorReply(CommandError(code: "bad-json", message: "\(error)", id: .none, op: nil)))
            }
        case .playback:
            do {
                let (rate, samples) = try FrameCodec.decodePlayback(f.payload)
                try audio.enqueue(rate: rate, samples: samples)
            } catch let e as AudioError {
                Output.shared.event("error", ["error": e.code, "message": e.description, "frame": "playback"])
            } catch {
                Output.shared.event("error", ["error": "bad-playback", "message": "\(error)", "frame": "playback"])
            }
        case .capture:
            Output.shared.event("error", ["error": "wrong-direction", "message": "capture frames are stdout only"])
        }
    }

    private func run(id: RequestId, _ cmd: Command) {
        let reply = { (fields: [String: Any]) in Output.shared.json(CommandParser.reply(id: id, op: cmd.op, fields: fields)) }
        let fail = { (code: String, msg: String) in
            Output.shared.json(CommandParser.errorReply(CommandError(code: code, message: msg, id: id, op: cmd.op)))
        }
        switch cmd {
        case .info:
            reply(infoFields())
        case .routeGet:
            reply(routeFields())
        case .micOn:
            // Aegis M1: a mic.off sent while the TCC prompt is open wins (MicGate generation);
            // M3: refused `not-disclaimed` unless responsibility was disclaimed or --no-disclaim was given
            micGate.requestOn { [weak self] outcome in
                guard let self else { return }
                switch outcome {
                case .notDisclaimed(let why):
                    return fail("not-disclaimed", "TCC responsibility was not disclaimed (\(why)); the grant would name the parent app. Restart without a stray token, or pass --no-disclaim deliberately")
                case .superseded:
                    return fail("superseded", "a mic.off or a newer mic.on arrived while the permission prompt was open")
                case .denied:
                    return fail("mic-denied", "microphone access is \(AudioCore.permission)")
                case .start:
                    break
                }
                do {
                    try self.audio.startMic()
                    let input: Any = self.audio.currentInput?.json ?? NSNull()
                    reply(["mic": true, "voiceProcessing": self.audio.voiceProcessing, "aec": self.aec.rawValue, "transport": self.transport, "input": input, "missing": self.audio.inputMissing])
                    Output.shared.event("mic", ["on": true, "voiceProcessing": self.audio.voiceProcessing, "aec": self.aec.rawValue, "transport": self.transport, "input": input, "missing": self.audio.inputMissing])
                } catch let e as AudioError {
                    fail(e.code, e.description)
                } catch {
                    fail("engine-start", "\(error)")
                }
            }
        case .micOff:
            micGate.off()
            audio.stopMic()
            reply(["mic": false])
            Output.shared.event("mic", ["on": false, "voiceProcessing": false, "aec": aec.rawValue, "transport": transport])
        case .playStop:
            let was = audio.isPlaying
            audio.stopPlayback()
            reply(["wasPlaying": was])
        case .playEnd:
            audio.endUtterance()
            reply([:])
        case .hotkeysSet(let update, let allowBare):
            let next: HotkeyConfig
            do { next = try hotkeys.config.applying(update, allowBare: allowBare) } catch let e as HotkeyError {
                return fail("bad-request", e.description)
            } catch { return fail("bad-request", "\(error)") }
            let errs = hotkeys.apply(next)
            if errs.isEmpty {
                reply(["hotkeys": hotkeys.config.json])
            } else {
                fail("hotkey-taken", "the system refused " + errs.map { "\($0.key.rawValue) (OSStatus \($0.value))" }.sorted().joined(separator: ", ") + "; the previous bindings stay")
            }
        case .inputsList:
            reply(inputFields())
        case .inputSelect(let uid):
            audio.preferredInput = uid
            do {
                if try audio.followInputChoice() { Output.shared.event("engine", ["what": "restarted", "mic": audio.micOn, "reason": "input-change"]) }
            } catch let e as AudioError {
                Output.shared.event("engine", ["what": "failed", "mic": false, "reason": e.code])
                Output.shared.event("mic", ["on": false, "voiceProcessing": false, "aec": aec.rawValue, "transport": transport])
            } catch {
                Output.shared.event("engine", ["what": "failed", "mic": false, "reason": "engine-start"])
            }
            reply(inputFields())
        case .quit:
            reply([:])
            shutdown(code: 0)
        }
    }

    /// inputs.list / input.select reply and the `inputs` event: every input device, the choice, the one in use.
    func inputFields() -> [String: Any] {
        let pick = InputDevices.resolve(preferred: audio.preferredInput)
        let current = audio.micOn ? audio.currentInput : pick.device
        return [
            "inputs": pick.inputs.prefix(16).map(\.json),
            "selected": audio.preferredInput ?? NSNull(),
            "current": current?.json ?? NSNull(),
            "missing": audio.micOn ? audio.inputMissing : pick.missing,
        ]
    }

    private var lastInputs: String?
    private func inputsChanged() {
        do {
            if try audio.followInputChoice() { Output.shared.event("engine", ["what": "restarted", "mic": audio.micOn, "reason": "input-change"]) }
        } catch let e as AudioError {
            Output.shared.event("engine", ["what": "failed", "mic": false, "reason": e.code])
            Output.shared.event("mic", ["on": false, "voiceProcessing": false, "aec": aec.rawValue, "transport": transport])
        } catch {
            Output.shared.event("engine", ["what": "failed", "mic": false, "reason": "engine-start"])
        }
        let f = inputFields()
        // our own voice-processing aggregates come and go with every engine: report only a real change
        let key = (try? JSONSerialization.data(withJSONObject: f, options: [.sortedKeys])).map { String(decoding: $0, as: UTF8.self) }
        if key == lastInputs { return }
        lastInputs = key
        Output.shared.event("inputs", f)
    }

    // MARK: state

    var aec: AecMode {
        RouteMath.aec(kind: (lastRoute ?? OutputRoute.current()).kind, voiceProcessing: audio.micOn && audio.voiceProcessing)
    }

    private func routeFields() -> [String: Any] {
        let r = lastRoute ?? OutputRoute.current()
        return ["route": r.json, "aec": aec.rawValue, "voiceProcessing": audio.voiceProcessing, "transport": r.transport ?? NSNull()]
    }

    /// Aegis L4: the transport rides every mic/route claim so the controller logs it beside `aec`.
    var transport: Any { (lastRoute ?? OutputRoute.current()).transport ?? NSNull() }

    func infoFields() -> [String: Any] {
        var f: [String: Any] = [
            "version": voiceIOVersion,
            "protocol": voiceIOProtocol,
            "pid": Int(getpid()),
            "bundle": Bundle.main.bundleIdentifier ?? NSNull(),
            "permission": AudioCore.permission,
            "hotkeys": hotkeys.config.json,
            "capture": ["sampleRate": 16_000, "channels": 1, "format": "s16le"],
            "playback": ["sampleRates": [Int(FrameCodec.minPlaybackRate), Int(FrameCodec.maxPlaybackRate)], "channels": 1, "format": "s16le"],
            "maxPayload": Int(FrameCodec.maxPayload),
        ]
        for (k, v) in routeFields() { f[k] = v }
        for (k, v) in audio.status { f[k] = v }
        for (k, v) in Disclaim.json { f[k] = v }
        for (k, v) in inputFields() { f[k] = v }
        return f
    }

    private func reportRoute(force: Bool) {
        let r = OutputRoute.current()
        if !force, r == lastRoute { return }
        lastRoute = r
        Output.shared.event("route", routeFields())
    }
}

func round1(_ v: Double) -> Double { (v * 10).rounded() / 10 }
