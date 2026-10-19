// TCC attribution (#gnomon-voice-io, probe P1). macOS charges a privacy grant
// to the RESPONSIBLE process, which for a child of Terminal (or of the Gnomon
// kernel) is that parent app, not this bundle. So every mode first re-spawns
// itself with responsibility disclaimed (the libsystem call Chromium and LLDB
// use; looked up at run time because it has no public header) and the child
// becomes responsible for itself: the Microphone list then names GnomonVoiceIO.
// stdin/stdout/stderr are inherited, so the framing passes straight through;
// the parent only forwards signals and the exit status.
//
// Aegis V2b: the child knows it was disclaimed only through a per-spawn random
// token (argv `--disclaim-token T` must equal env GNOMON_VOICE_IO_DISCLAIMED);
// a stray inherited env var is ignored (M3). The re-spawn path comes from
// _NSGetExecutablePath + realpath only, never argv[0] (L1). The child watches
// both the re-spawning parent and the original parent and exits when either
// dies (M2, ParentWatch). `--no-disclaim` skips all of this (the P1 control).

import Darwin
import Foundation
import VoiceIOCore

enum Disclaim {
    /// true only in a child whose token checked out
    private(set) static var disclaimed = false
    /// why `disclaimed` is false: no-disclaim-flag | unavailable | setdisclaim-failed | spawn-failed | exec-path | token-mismatch
    private(set) static var reason: String? = "not-run"
    private(set) static var noDisclaimFlag = false
    private static var watch: ParentWatch?

    typealias SetDisclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32

    static var json: [String: Any] {
        let why: Any = disclaimed ? NSNull() : (reason.map { $0 as Any } ?? NSNull())
        return ["disclaimed": disclaimed, "disclaimReason": why]
    }

    /// mic.on is allowed when disclaimed, or when the operator chose --no-disclaim.
    static var micAllowed: (ok: Bool, reason: String) {
        (disclaimed || noDisclaimFlag, reason ?? "")
    }

    static func executablePath() -> String? {
        var size = UInt32(PATH_MAX)
        var buf = [CChar](repeating: 0, count: Int(size))
        if _NSGetExecutablePath(&buf, &size) != 0 {
            buf = [CChar](repeating: 0, count: Int(size))
            guard _NSGetExecutablePath(&buf, &size) == 0 else { return nil }
        }
        guard let real = realpath(buf, nil) else { return nil }
        defer { free(real) }
        return String(cString: real)
    }

    static func argValue(_ args: [String], _ flag: String) -> String? {
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    /// Returns in the child (or when disclaiming is off or failed); the re-spawning parent exits with the child.
    static func setUp(args: [String], noDisclaim: Bool) {
        let env = ProcessInfo.processInfo.environment[DisclaimToken.envKey]
        unsetenv(DisclaimToken.envKey) // never leaks further down
        let argToken = argValue(args, DisclaimToken.argFlag)
        if noDisclaim {
            noDisclaimFlag = true
            reason = "no-disclaim-flag"
            watchParents(original: nil)
            return
        }
        switch DisclaimToken.check(argvToken: argToken, envToken: env) {
        case .disclaimed:
            disclaimed = true
            reason = nil
            watchParents(original: argValue(args, DisclaimToken.parentFlag).flatMap { pid_t($0) })
            return
        case .mismatch:
            reason = "token-mismatch"
            diag("disclaim token mismatch: not treated as disclaimed; mic.on will refuse")
            watchParents(original: nil)
            return
        case .fresh:
            break
        }
        respawn(args: args)
        watchParents(original: nil) // only reached when the re-spawn did not happen
    }

    private static func watchParents(original: pid_t?) {
        var pids = [getppid()]
        if let o = original, o != pids[0] { pids.append(o) }
        watch = ParentWatch(pids: pids) { pid in
            diag("parent \(pid) exited; exiting")
            exit(0)
        }
    }

    private static func respawn(args: [String]) {
        guard let path = executablePath() else {
            reason = "exec-path"
            diag("cannot resolve the executable path; TCC will name the parent app")
            return
        }
        guard let h = dlopen(nil, RTLD_NOW), let sym = dlsym(h, "responsibility_spawnattrs_setdisclaim") else {
            reason = "unavailable"
            diag("responsibility_spawnattrs_setdisclaim is unavailable; TCC will name the parent app")
            return
        }
        let setDisclaim = unsafeBitCast(sym, to: SetDisclaim.self)
        var attr: posix_spawnattr_t?
        posix_spawnattr_init(&attr)
        defer { posix_spawnattr_destroy(&attr) }
        guard setDisclaim(&attr, 1) == 0 else {
            reason = "setdisclaim-failed"
            diag("disclaim failed; TCC will name the parent app")
            return
        }
        let token = DisclaimToken.make()
        // drop any token / parent flags the caller passed, so only ours reach the child
        var userArgs: [String] = []
        var skip = false
        for a in args {
            if skip { skip = false; continue }
            if a == DisclaimToken.argFlag || a == DisclaimToken.parentFlag { skip = true; continue }
            userArgs.append(a)
        }
        let childArgs = [path] + userArgs + [DisclaimToken.argFlag, token, DisclaimToken.parentFlag, String(getppid())]
        let argv: [UnsafeMutablePointer<CChar>?] = childArgs.map { strdup($0) } + [nil]
        setenv(DisclaimToken.envKey, token, 1)
        var pid: pid_t = 0
        let st = posix_spawn(&pid, path, nil, &attr, argv, environ)
        unsetenv(DisclaimToken.envKey)
        guard st == 0 else {
            reason = "spawn-failed"
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
