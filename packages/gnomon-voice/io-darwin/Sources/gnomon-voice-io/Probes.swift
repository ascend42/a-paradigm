// Founder-run modes of #gnomon-voice-io (PROBES.md). Output is plain NDJSON on
// stdout (not framed), one line per step and a final summary line.
//
//   --selftest            1 s of the duplex engine: capture frames counted, a
//                         0.4 s quiet tone played through the same engine, the
//                         route and aec mode reported. Exit 0 iff audio arrived.
//   --probe-aec <file>    P7: capture while playing <file> (e.g. `say -o` TTS)
//                         through the speakers, once with voice processing and
//                         once without; reports the residual and the leak.

import AVFoundation
import Foundation
import VoiceIOCore

/// Mean square of captured samples while `collecting` (tap thread → main).
final class CaptureStats {
    private let lock = NSLock()
    private var acc = 0.0
    private var n = 0
    private(set) var frames = 0
    private(set) var firstHostNs: UInt64 = 0
    var collecting = true

    func feed(_ ns: UInt64, _ s: [Int16]) {
        lock.lock(); defer { lock.unlock() }
        frames += 1
        if firstHostNs == 0 { firstHostNs = ns }
        guard collecting else { return }
        for v in s { let x = Double(v) / 32768; acc += x * x }
        n += s.count
    }

    func take() -> (dbfs: Double, samples: Int) {
        lock.lock(); defer { lock.unlock() }
        let r = (n > 0 ? Level.dbfs(meanSquare: acc / Double(n)) : Level.floorDBFS, n)
        acc = 0; n = 0
        return r
    }

    var snapshot: (frames: Int, firstHostNs: UInt64) {
        lock.lock(); defer { lock.unlock() }
        return (frames, firstHostNs)
    }
}

func printLine(_ obj: [String: Any]) {
    let d = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(d + Data("\n".utf8))
}

enum Selftest {
    static func run() -> Never {
        let audio = AudioCore()
        let stats = CaptureStats()
        var lastLevel = Level.floorDBFS
        var playback: [String] = []
        audio.onCapture = { ns, s in stats.feed(ns, s) }
        audio.onLevel = { rms, _ in DispatchQueue.main.async { lastLevel = rms } }
        audio.onPlayback = { name, f in playback.append("\(name)\((f["reason"] as? String).map { ":" + $0 } ?? "")") }
        printLine(["selftest": "start", "version": voiceIOVersion, "permission": AudioCore.permission, "bundle": Bundle.main.bundleIdentifier ?? NSNull()])
        AudioCore.requestPermission { ok in
            guard ok else {
                printLine(["selftest": "fail", "reason": "mic-denied", "permission": AudioCore.permission])
                exit(1)
            }
            do { try audio.startMic() } catch {
                printLine(["selftest": "fail", "reason": "\(error)"])
                exit(1)
            }
            let started = Clock.nowNs()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                // 0.4 s, 440 Hz, -30 dBFS through the duplex engine (exercises playback + AEC reference)
                let n = 6_400
                let tone = (0..<n).map { i in Int16(1036 * sin(2 * Double.pi * 440 * Double(i) / 16_000)) }
                try? audio.enqueue(rate: 16_000, samples: tone)
                audio.endUtterance()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                let elapsed = Double(Clock.nowNs() - started) / 1e9
                let (frames, first) = stats.snapshot
                let (_, samples) = stats.take()
                let route = OutputRoute.current()
                let vp = audio.voiceProcessing
                audio.stopMic()
                let ok = frames > 0 && samples > 8_000
                printLine([
                    "selftest": ok ? "pass" : "fail",
                    "seconds": round1(elapsed * 10) / 10,
                    "frames": frames,
                    "samples": samples,
                    "sampleRate": 16_000,
                    "firstHostNs": first,
                    "levelDBFS": round1(lastLevel),
                    "voiceProcessing": vp,
                    "aec": RouteMath.aec(kind: route.kind, voiceProcessing: vp).rawValue,
                    "route": route.json,
                    "playback": playback,
                ])
                exit(ok ? 0 : 1)
            }
        }
        dispatchMain()
    }
}

enum ProbeAEC {
    static let maxSeconds = 15.0

    static func run(file: String) -> Never {
        let samples: [Int16]
        let rate: UInt32
        do { (rate, samples) = try load(file) } catch {
            printLine(["probe": "P7", "result": "fail", "reason": "cannot read \(file): \(error.localizedDescription)"])
            exit(1)
        }
        let refDBFS = Level.rmsDBFS(samples)
        let audio = AudioCore()
        let stats = CaptureStats()
        audio.onCapture = { ns, s in stats.feed(ns, s) }
        var onEnd: (() -> Void)?
        audio.onPlayback = { name, f in
            if name == "playback.start" { _ = stats.take(); stats.collecting = true }
            if name == "playback.end" { stats.collecting = false; let k = onEnd; onEnd = nil; k?() }
            _ = f
        }
        var result: [String: Any] = ["probe": "P7", "file": (file as NSString).lastPathComponent, "referenceDBFS": round1(refDBFS), "seconds": round1(Double(samples.count) / Double(rate))]

        func play(then next: @escaping () -> Void) {
            onEnd = next
            stats.collecting = false
            let chunk = Int(rate) / 10
            var i = 0
            while i < samples.count {
                try? audio.enqueue(rate: rate, samples: Array(samples[i..<min(i + chunk, samples.count)]))
                i += chunk
            }
            audio.endUtterance()
        }

        func finish() {
            audio.stopMic()
            let route = OutputRoute.current()
            result["route"] = route.json
            result["aecIfVoiceProcessing"] = RouteMath.aec(kind: route.kind, voiceProcessing: true).rawValue
            if let vp = result["vpResidualDBFS"] as? Double, let raw = result["rawLeakDBFS"] as? Double, let q = result["quietDBFS"] as? Double {
                result["attenuationDB"] = round1(raw - vp)
                result["residualOverQuietDB"] = round1(vp - q)
            }
            if route.kind == .headphones { result["warning"] = "the output is headphones: P7 needs the built-in speakers" }
            result["result"] = "measured"
            printLine(result)
            exit(0)
        }

        AudioCore.requestPermission { ok in
            guard ok else {
                printLine(["probe": "P7", "result": "fail", "reason": "mic-denied", "permission": AudioCore.permission])
                exit(1)
            }
            do { try audio.startMic(voiceProcessing: true) } catch {
                printLine(["probe": "P7", "result": "fail", "reason": "\(error)"]); exit(1)
            }
            result["voiceProcessing"] = audio.voiceProcessing
            printLine(["probe": "P7", "step": "quiet", "note": "stay silent for 2 s"])
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { _ = stats.take(); stats.collecting = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                result["quietDBFS"] = round1(stats.take().dbfs)
                printLine(["probe": "P7", "step": "vp", "note": "playing with voice processing"])
                play {
                    result["vpResidualDBFS"] = round1(stats.take().dbfs)
                    audio.stopMic()
                    do { try audio.startMic(voiceProcessing: false) } catch {
                        printLine(["probe": "P7", "result": "fail", "reason": "raw engine: \(error)"]); exit(1)
                    }
                    printLine(["probe": "P7", "step": "raw", "note": "playing WITHOUT voice processing (the leak to compare)"])
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        play {
                            result["rawLeakDBFS"] = round1(stats.take().dbfs)
                            finish()
                        }
                    }
                }
            }
        }
        dispatchMain()
    }

    /// Channel 0 of the file as Int16 at the file's rate (8–48 kHz), at most maxSeconds.
    static func load(_ path: String) throws -> (UInt32, [Int16]) {
        let f = try AVAudioFile(forReading: URL(fileURLWithPath: path))
        let fmt = f.processingFormat
        let rate = UInt32(fmt.sampleRate)
        guard rate >= FrameCodec.minPlaybackRate, rate <= FrameCodec.maxPlaybackRate else {
            throw NSError(domain: "gnomon-voice-io", code: 1, userInfo: [NSLocalizedDescriptionKey: "sample rate \(rate) is outside 8000...48000"])
        }
        let frames = AVAudioFrameCount(min(Double(f.length), maxSeconds * fmt.sampleRate))
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: frames) else { throw NSError(domain: "gnomon-voice-io", code: 2) }
        try f.read(into: buf, frameCount: frames)
        guard let ch = buf.floatChannelData else { throw NSError(domain: "gnomon-voice-io", code: 3) }
        let out = (0..<Int(buf.frameLength)).map { i in Int16(max(-1, min(1, ch[0][i])) * 32767) }
        return (rate, out)
    }
}
