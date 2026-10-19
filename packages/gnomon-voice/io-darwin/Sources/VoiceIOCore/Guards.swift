// Process and mic guards of #gnomon-voice-io (Aegis V2b review: M1, M2, M3).
// Pure or Darwin-only, no audio, so `swift test` covers them.
//
//   MicGate       mic.on asks TCC asynchronously; a mic.off (or a newer mic.on)
//                 sent while the prompt is open WINS: the permission callback
//                 checks a generation counter before the engine may start (M1).
//                 It also refuses mic.on when TCC responsibility was not
//                 disclaimed, unless the binary was started with --no-disclaim (M3).
//   DisclaimToken the re-spawned child is "disclaimed" only when the env token
//                 equals a per-spawn random token the parent passed in argv, so a
//                 stray inherited GNOMON_VOICE_IO_DISCLAIMED cannot fake it (M3).
//   ParentWatch   kqueue EVFILT_PROC NOTE_EXIT on the parent pids: the child
//                 exits when its re-spawning parent or the original parent dies (M2).

import Darwin
import Foundation

private typealias KEvent = Darwin.kevent

public enum MicGateOutcome: Equatable {
    /// permission granted and still wanted: start the engine
    case start
    case denied
    /// a mic.off or a newer mic.on arrived while the prompt was open
    case superseded
    case notDisclaimed(String)
}

public final class MicGate {
    /// Asks for mic permission; calls back once with the answer (on the caller's queue).
    public typealias PermissionProvider = (@escaping (Bool) -> Void) -> Void

    private let provider: PermissionProvider
    private let disclaimAllowed: () -> (ok: Bool, reason: String)
    public private(set) var generation = 0

    public init(provider: @escaping PermissionProvider, disclaimAllowed: @escaping () -> (ok: Bool, reason: String)) {
        self.provider = provider
        self.disclaimAllowed = disclaimAllowed
    }

    public func requestOn(_ done: @escaping (MicGateOutcome) -> Void) {
        generation += 1
        let g = generation
        let d = disclaimAllowed()
        guard d.ok else { return done(.notDisclaimed(d.reason)) }
        provider { [weak self] ok in
            guard let self, g == self.generation else { return done(.superseded) }
            done(ok ? .start : .denied)
        }
    }

    /// mic.off: any prompt still open resolves to `.superseded`.
    public func off() { generation += 1 }
}

public enum DisclaimToken {
    public static let envKey = "GNOMON_VOICE_IO_DISCLAIMED"
    public static let argFlag = "--disclaim-token"
    public static let parentFlag = "--parent-pid"

    /// 128 random bits as 32 lowercase hex characters.
    public static func make() -> String {
        var b = [UInt8](repeating: 0, count: 16)
        arc4random_buf(&b, b.count)
        return b.map { String(format: "%02x", $0) }.joined()
    }

    public static func wellFormed(_ t: String) -> Bool {
        t.count == 32 && t.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
    }

    public enum State: Equatable {
        /// no token in argv: this is the first process; it should re-spawn (a stray env var is ignored)
        case fresh
        /// argv token matches the env token: this is the disclaimed child
        case disclaimed
        /// argv names a token the env does not match: refuse to treat it as disclaimed, do not re-spawn
        case mismatch
    }

    public static func check(argvToken: String?, envToken: String?) -> State {
        guard let a = argvToken else { return .fresh }
        guard wellFormed(a), let e = envToken, e == a else { return .mismatch }
        return .disclaimed
    }
}

public final class ParentWatch {
    private let kq: Int32
    private var thread: Thread?

    /// Watches `pids` for exit. `onExit` runs on a private thread with the pid that
    /// ended, or immediately when a pid is already gone (or is 1: we were re-parented).
    public init(pids: [pid_t], onExit: @escaping (pid_t) -> Void) {
        kq = kqueue()
        let watch = pids.filter { $0 > 0 }
        if let gone = watch.first(where: { $0 == 1 }) { onExit(gone); return }
        guard kq >= 0, !watch.isEmpty else { return }
        var changes = watch.map {
            KEvent(ident: UInt($0), filter: Int16(EVFILT_PROC), flags: UInt16(EV_ADD | EV_ONESHOT | EV_RECEIPT), fflags: NOTE_EXIT, data: 0, udata: nil)
        }
        var receipts = [KEvent](repeating: KEvent(), count: changes.count)
        let n = kevent(kq, &changes, Int32(changes.count), &receipts, Int32(receipts.count), nil)
        for i in 0..<max(0, Int(n)) where receipts[i].flags & UInt16(EV_ERROR) != 0 && receipts[i].data != 0 {
            onExit(pid_t(receipts[i].ident)) // ESRCH: already dead
            return
        }
        let kq = self.kq
        let t = Thread {
            var ev = KEvent()
            while true {
                let r = kevent(kq, nil, 0, &ev, 1, nil)
                if r < 0 && errno == EINTR { continue }
                if r > 0 { onExit(pid_t(ev.ident)) }
                return
            }
        }
        t.name = "gnomon-voice-io.parent-watch"
        t.start()
        thread = t
    }
}
