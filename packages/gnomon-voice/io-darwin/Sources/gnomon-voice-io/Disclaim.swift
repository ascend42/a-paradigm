// TCC attribution (#gnomon-voice-io, probe P1). macOS charges a privacy grant
// to the RESPONSIBLE process, which for a child of Terminal (or of the Gnomon
// kernel) is that parent app, not this bundle. So every mic-using mode first
// re-spawns itself with responsibility disclaimed (the libsystem call Chromium
// and LLDB use; looked up at run time because it has no public header) and
// the child becomes responsible for itself: the Microphone list then names
// GnomonVoiceIO. stdin/stdout/stderr are inherited, so the framing passes
// straight through; the parent only forwards signals and the exit status.
// `--no-disclaim` skips this (the P1 control run).

import Darwin
import Foundation

enum Disclaim {
    static let envKey = "GNOMON_VOICE_IO_DISCLAIMED"

    typealias SetDisclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32

    /// Returns only in the child (or when disclaiming is unavailable); the parent exits with the child.
    static func respawnIfNeeded() {
        if ProcessInfo.processInfo.environment[envKey] == "1" { return }
        guard let h = dlopen(nil, RTLD_NOW), let sym = dlsym(h, "responsibility_spawnattrs_setdisclaim") else {
            diag("responsibility_spawnattrs_setdisclaim is unavailable; TCC will name the parent app")
            return
        }
        let setDisclaim = unsafeBitCast(sym, to: SetDisclaim.self)
        var attr: posix_spawnattr_t?
        posix_spawnattr_init(&attr)
        defer { posix_spawnattr_destroy(&attr) }
        guard setDisclaim(&attr, 1) == 0 else {
            diag("disclaim failed; TCC will name the parent app")
            return
        }
        let path = Bundle.main.executablePath ?? CommandLine.arguments[0]
        setenv(envKey, "1", 1)
        let argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
        var pid: pid_t = 0
        let st = posix_spawn(&pid, path, nil, &attr, argv, environ)
        unsetenv(envKey)
        guard st == 0 else {
            diag("re-spawn failed (\(st)); running without disclaim")
            return
        }
        for sig in [SIGINT, SIGTERM, SIGHUP] {
            signal(sig, SIG_IGN)
            let src = DispatchSource.makeSignalSource(signal: sig, queue: .global())
            src.setEventHandler { kill(pid, sig) }
            src.resume()
            forwarders.append(src)
        }
        var status: Int32 = 0
        while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
        let code: Int32 = (status & 0x7F) == 0 ? (status >> 8) & 0xFF : 128 + (status & 0x7F)
        exit(code)
    }

    private static var forwarders: [DispatchSourceSignal] = []
}
