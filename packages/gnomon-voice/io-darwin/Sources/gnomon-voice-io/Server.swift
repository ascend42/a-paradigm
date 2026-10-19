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
    private var routeWatch: RouteWatch?
    private var lastRoute: OutputRoute?

    func start() {
        audio.onCapture = { ns, samples in Output.shared.capture(hostTimeNs: ns, samples: samples) }
        audio.onLevel = { rms, peak in Output.shared.event("level", ["rmsDBFS": round1(rms), "peakDBFS": round1(peak)]) }
        audio.onPlayback = { name, fields in Output.shared.event(name, fields) }
        audio.onEngineRestart = { [weak self] what in
            guard let self else { return }
            Output.shared.event("engine", ["what": what, "mic": self.audio.micOn])
            self.reportRoute(force: true)
        }
        hotkeys.onHotkey = { action, phase in Output.shared.event("hotkey", ["action": action.rawValue, "phase": phase]) }
        let errs = hotkeys.apply(HotkeyConfig.defaults)
        routeWatch = RouteWatch { [weak self] in self?.reportRoute(force: false) }
        lastRoute = OutputRoute.current()
        var ready = infoFields()
        if !errs.isEmpty { ready["hotkeyErrors"] = errs.map { "\($0.key.rawValue): OSStatus \($0.value)" }.sorted() }
        Output.shared.event("ready", ready)

        let t = Thread { Server.readLoop() }
        t.name = "gnomon-voice-io.stdin"
        t.start()
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
            AudioCore.requestPermission { [weak self] ok in
                guard let self else { return }
                guard ok else { return fail("mic-denied", "microphone access is \(AudioCore.permission)") }
                do {
                    try self.audio.startMic()
                    reply(["mic": true, "voiceProcessing": self.audio.voiceProcessing, "aec": self.aec.rawValue])
                    Output.shared.event("mic", ["on": true, "voiceProcessing": self.audio.voiceProcessing, "aec": self.aec.rawValue])
                } catch let e as AudioError {
                    fail(e.code, e.description)
                } catch {
                    fail("engine-start", "\(error)")
                }
            }
        case .micOff:
            audio.stopMic()
            reply(["mic": false])
            Output.shared.event("mic", ["on": false, "voiceProcessing": false, "aec": aec.rawValue])
        case .playStop:
            let was = audio.isPlaying
            audio.stopPlayback()
            reply(["wasPlaying": was])
        case .playEnd:
            audio.endUtterance()
            reply([:])
        case .hotkeysSet(let update):
            let next: HotkeyConfig
            do { next = try hotkeys.config.applying(update) } catch let e as HotkeyError {
                return fail("bad-request", e.description)
            } catch { return fail("bad-request", "\(error)") }
            let errs = hotkeys.apply(next)
            if errs.isEmpty {
                reply(["hotkeys": hotkeys.config.json])
            } else {
                fail("hotkey-taken", "the system refused " + errs.map { "\($0.key.rawValue) (OSStatus \($0.value))" }.sorted().joined(separator: ", ") + "; the previous bindings stay")
            }
        case .quit:
            reply([:])
            shutdown(code: 0)
        }
    }

    // MARK: state

    var aec: AecMode {
        RouteMath.aec(kind: (lastRoute ?? OutputRoute.current()).kind, voiceProcessing: audio.micOn && audio.voiceProcessing)
    }

    private func routeFields() -> [String: Any] {
        let r = lastRoute ?? OutputRoute.current()
        return ["route": r.json, "aec": aec.rawValue, "voiceProcessing": audio.voiceProcessing]
    }

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
