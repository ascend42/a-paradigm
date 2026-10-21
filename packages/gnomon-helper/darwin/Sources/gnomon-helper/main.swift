// gnomon-helper (darwin) — the signed helper of the Gnomon kernel (spec §3.1,
// §16, §18; M1.3 slice 1; 1.6.0 voice arm custody, §14.7). Holds what the
// kernel must never hold: the root and approvals P-256 keys in the Secure
// Enclave, behind presence, and every evaluated LAContext (cached unlocks per
// connId, voice arms per armId, S29-K5).
//
//   gnomon-helper --version        print the version, exit 0
//   gnomon-helper serve            NDJSON request/reply loop on stdin/stdout
//                                  (the kernel's long-lived child: holds the
//                                  per-connection approvals unlocks and the
//                                  voice arms; EOF on stdin ends it and every
//                                  unlock and arm with it). Requests run on a
//                                  reader thread; the main thread runs the
//                                  run loop that observes lock / screensaver /
//                                  display sleep / system sleep / user switch
//                                  (SessionWatch.swift) and PUSHES an event.
//   gnomon-helper probe-decision <gen>
//                                  Aegis C4 hardware probe (TD-2026-10-20-514), run by the founder ON DEVICE:
//                                  ONE evaluatePresence (one dialog), then the approvals key AND the root key of
//                                  <gen> each sign a probe message under that one context; both are verified by
//                                  their public keys. Then the negative case: a NEW, unevaluated context with
//                                  interactionNotAllowed must fail to sign with the root key, showing no dialog.
//                                  Prints one JSON line; exit 0 only when every check holds.
//   gnomon-helper once             one request line in, one reply line out
//                                  (root signatures from the CLI; no observer,
//                                  it holds nothing past its one reply)
//
// Ops, protocol gnomon-helper:v2 (Protocol.swift for the wire format and bounds; Server.swift):
//   info                                      → {version, protocol, pid, signing, unlocks, arms}
//   key.list                                  → {keys: [{gen, key}]}
//   key.create  {key, gen, rotate?}           → {publicKey}   (refuses `exists`; refuses `other-generation`
//                                               when a key of another gen exists, unless `rotate` carries
//                                               {fromGen, statement, sig}: a gnomon-root-rotate:v1 row naming
//                                               toGen = gen, signed by the root of fromGen — Aegis H2)
//   key.public  {key, gen}                    → {publicKey}   (`not-found`)
//   key.delete  {key, gen, reason}            → {deleted, statement, sig?}  FRESH presence over a
//                                               helper-composed delete statement, signed by the root of
//                                               gen when it exists (H2); no presence only for a gen this
//                                               process created itself (failed-provision cleanup).
//                                               Deleting approvals drops every unlock and arm.
//   sign        {key, gen, mode: fresh|cached, connId?, keep?, reason, messages[]}
//                                             → {sigs[], kept}   NEVER the voice domain (G-BRK-06)
//   decision.sign {gen, reason, connId?, approvals: [b64 ×0..2], root: [b64 ×1..8]}   (1.8.0, TD-2026-10-20-514)
//                                             → {approvalSigs[], rootSigs[], shown, kept: false}  ONE fresh presence
//                                               signs a card decision's approve:v1 + presence:v1 messages and every
//                                               row-sig:v1 root row; refuses keep; bad-request / domain-refused /
//                                               batch-refused (decisionBatchRefusal) before any key is touched
//   presence.available                        → {available, biometrics, error?}  (LAContext canEvaluatePolicy; NEVER a prompt)
//   unlock.drop {connId}                      → {dropped}
//   unlock.drop-all                           → {dropped: n}
//   (v2) arm.open  {armId, gen, humanConnId, voiceConnId, hardSeconds, idleSeconds?, maxSignatures?, reason, messages[]}
//                                             → {sigs[], armId, kept, shown}  FRESH presence; the prompt names
//                                               the pair and bounds; refuses arm-exists, arm-limit (Bounds.maxArms,
//                                               its own cap), arm-invalidated (a session event during the prompt)
//   (v2) arm.sign  {armId, gen, humanConnId, voiceConnId, messages[]}
//                                             → {sigs[], armId}  ONLY gnomon:approve-voice:v1, only for that pair;
//                                               `no-arm` otherwise; never a prompt
//   (v2) arm.close {armId}                    → {closed}
//   (v2) arm.close-all                        → {closed: n}
//   (v2) conn.close {connId}                  → {dropped, arms[]}  the connection's unlock and every arm naming it
//   (v2) push {push:"session", cause, arms[], unlocks, seq}   unsolicited, after invalidating everything
//
// Refuses to run sandboxed (P8-D68): {"ok":false,"error":"sandboxed"}, exit 3.

import Foundation

// gnomonHelperVersion and helperProtocol live in Protocol.swift (a main.swift global is never initialized under `swift test`)

typealias SandboxCheck = @convention(c) (pid_t, UnsafePointer<CChar>?, Int32) -> Int32
func isSandboxed() -> Bool {
    // Aegis M5 (round 3): if the check cannot be made, assume sandboxed — fail CLOSED
    guard let h = dlopen(nil, RTLD_NOW), let s = dlsym(h, "sandbox_check") else { return true }
    return unsafeBitCast(s, to: SandboxCheck.self)(getpid(), nil, 0) != 0
}

let arguments = Array(CommandLine.arguments.dropFirst())

if arguments.contains("--version") || arguments.contains("-v") {
    print("gnomon-helper \(gnomonHelperVersion)")
    exit(0)
}

let output = Output()

if isSandboxed() {
    output.emit(replyLine(["id": NSNull(), "ok": false, "error": "sandboxed", "message": "the helper refuses to run sandboxed (P8-D68)"]))
    exit(3)
}

let server = Server()

switch arguments.first {
case "serve":
    // the observer registers on the main thread, which then runs the main run loop for its notifications,
    // IOKit power messages and the 250 ms poll; requests are served on a reader thread
    let watch = SessionWatch(custody: server.custody, source: SystemSessionEvents(), output: output)
    watch.start()
    let reader = Thread {
        let code = server.serve(onlyOne: false, output: output) // EOF: invalidates every unlock and arm
        exit(code)
    }
    reader.stackSize = 1 << 20
    reader.start()
    CFRunLoopRun()
    exit(0)
case "once":
    exit(server.serve(onlyOne: true, output: output))
case "probe-decision":
    guard arguments.count == 2, let gen = try? generation(["gen": arguments[1]]) else {
        FileHandle.standardError.write(Data("usage: gnomon-helper probe-decision <gen>\n".utf8))
        exit(64)
    }
    output.emit(replyLine(probeDecision(gen: gen)))
    exit(0)
default:
    FileHandle.standardError.write(Data("usage: gnomon-helper --version | serve | once | probe-decision <gen>\n".utf8))
    exit(64)
}
