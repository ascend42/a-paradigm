// gnomon-voice-io (darwin) — the audio I/O child of Gnomon voice (#gnomon-voice-io;
// TD-2026-10-19-298, slice V2b, T-2026-10-19-026). Mic only: no keychain, no
// network, writes nothing but stdout/stderr.
//
//   gnomon-voice-io --version             print the version, exit 0
//   gnomon-voice-io [serve]               the framed protocol gnomon-voice-io:v1 on stdin/stdout
//                                         (Frame.swift, Command.swift); stdin EOF exits 0
//   gnomon-voice-io --selftest            1 s smoke run, NDJSON summary (PROBES.md)
//   gnomon-voice-io --probe-aec <file>    probe P7, the AEC leak (PROBES.md)
//   … --no-disclaim                       keep the parent as the TCC-responsible app (P1 control)
//
// Events (JSON frames, {"type":"event","event",tUs,...}; tUs = monotonic µs, the
// same clock as capture hostTimeNs / 1000):
//   ready {info…}  mic {on, voiceProcessing, aec}  route {route, aec, voiceProcessing}
//   level {rmsDBFS, peakDBFS} ~15 Hz while the mic is on
//   playback.start {engine, audibleAtUs, outputLatencyUs}  playback.end {reason, utteranceEnded, queuedMs}
//   hotkey {action: talk|mic-toggle|mode-toggle|hold-toggle, phase: down|up}
//   engine {what, mic}  error {error, message}  exit {code}

import AppKit
import Foundation
import VoiceIOCore

signal(SIGPIPE, SIG_IGN)

let args = Array(CommandLine.arguments.dropFirst())
if args.contains("--version") {
    print("gnomon-voice-io \(voiceIOVersion)")
    exit(0)
}
let known: Set<String> = ["serve", "--selftest", "--probe-aec", "--no-disclaim"]
let takesValue: Set<String> = ["--probe-aec", DisclaimToken.argFlag, DisclaimToken.parentFlag]
if let bad = args.enumerated().first(where: { i, a in !known.contains(a) && !takesValue.contains(a) && !(i > 0 && takesValue.contains(args[i - 1])) }) {
    diag("unknown argument \(bad.element); usage: gnomon-voice-io [--version | serve | --selftest | --probe-aec <file>] [--no-disclaim]")
    exit(64)
}
// re-spawns with TCC responsibility disclaimed (the parent waits here and exits with the child),
// then watches the parent(s) and exits when one dies
Disclaim.setUp(args: args, noDisclaim: args.contains("--no-disclaim"))

if args.contains("--selftest") {
    Selftest.run()
}
if let i = args.firstIndex(of: "--probe-aec") {
    guard i + 1 < args.count else {
        diag("--probe-aec needs an audio file (e.g. say -o \"$TMPDIR/p7.aiff\" \"…\")")
        exit(64)
    }
    ProbeAEC.run(file: args[i + 1])
}

// serve: an accessory app (no Dock icon) so Carbon hotkeys reach us through the app event loop
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let server = Server()
Server.current = server
server.start()
app.run()
