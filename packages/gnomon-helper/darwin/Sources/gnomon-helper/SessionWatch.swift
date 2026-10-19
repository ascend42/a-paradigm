// gnomon-helper (darwin) — the session observer (helper 1.6.0; spec §14.7
// "screen lock, display sleep, user switch or system sleep (observed by the
// helper; within 1 s)", S26-C3 "drops on … screen lock / sleep / user
// switch", §A.1 cached unlocks).
//
// On ANY of those events the helper invalidates every voice arm and every
// cached unlock FIRST (Custody.invalidateAll), then PUSHES one unsolicited
// line to the kernel:
//
//   {"arms":[…],"cause":"screen-lock","push":"session","seq":1,"unlocks":2}
//
// The push is advisory for the kernel's own records; the security property
// (nothing signs after the event) holds in the helper whether or not the
// kernel reads it.
//
// Sources (SystemSessionEvents), every one of them, so a missed notification
// is caught by the next:
//   - distributed notifications com.apple.screenIsLocked, com.apple.screensaver.didstart
//   - NSWorkspace screensDidSleep, willSleep, sessionDidResignActive
//   - IOKit system power (kIOMessageSystemWillSleep; the sleep is acknowledged after the invalidation)
//   - a 250 ms poll of the CGSession dictionary (screen locked, session off console) and
//     CGDisplayIsAsleep, edge-triggered: the 1 s bound holds even where no notification arrives
// The source is injected (SessionEventSource) so tests drive it without locking the screen.

import AppKit
import CoreGraphics
import Foundation
import IOKit
import IOKit.pwr_mgt

/// Why every arm and unlock just ended. The raw values are the push's `cause` (protocol v2).
enum SessionCause: String, CaseIterable {
    case screenLock = "screen-lock"
    case screensaver = "screensaver"
    case displaySleep = "display-sleep"
    case systemSleep = "system-sleep"
    case userSwitch = "user-switch"
}

/// Something that reports session events. `fire` may be called on any thread.
protocol SessionEventSource: AnyObject {
    func start(_ fire: @escaping (SessionCause) -> Void)
    func stop()
}

/// Invalidate, then push. One instance per `serve` process.
final class SessionWatch {
    private let custody: Custody
    private let source: SessionEventSource
    private let output: Output
    private let lock = NSLock()
    private var seq = 0

    init(custody: Custody, source: SessionEventSource, output: Output) {
        self.custody = custody
        self.source = source
        self.output = output
    }

    func start() {
        source.start { [weak self] cause in self?.fired(cause) }
    }

    func stop() {
        source.stop()
    }

    /// The observer callback: invalidation happens BEFORE the push is written (and before this returns).
    func fired(_ cause: SessionCause) {
        let closed = custody.invalidateAll()
        lock.lock()
        seq += 1
        let n = seq
        lock.unlock()
        output.emit(pushLine(cause: cause, arms: closed.arms, unlocks: closed.unlocks, seq: n))
    }
}

/// The v2 push frame (sorted keys, no `id`).
func pushLine(cause: SessionCause, arms: [String], unlocks: Int, seq: Int) -> Data {
    replyLine(["push": "session", "cause": cause.rawValue, "arms": arms, "unlocks": unlocks, "seq": seq])
}

/// Production source. start() must be called on the main thread, which then runs the main run loop.
final class SystemSessionEvents: SessionEventSource {
    private var fire: ((SessionCause) -> Void)?
    private var tokens: [(NotificationCenter, NSObjectProtocol)] = []
    private var timer: Timer?
    private var wasLocked = false
    private var wasOffConsole = false
    private var wasDisplayAsleep = false
    private var powerRoot: io_connect_t = 0
    private var powerPort: IONotificationPortRef?
    private var powerNotifier: io_object_t = 0

    func start(_ fire: @escaping (SessionCause) -> Void) {
        self.fire = fire
        let dnc = DistributedNotificationCenter.default()
        observe(dnc, "com.apple.screenIsLocked", .screenLock)
        observe(dnc, "com.apple.screensaver.didstart", .screensaver)
        let ws = NSWorkspace.shared.notificationCenter
        observe(ws, NSWorkspace.screensDidSleepNotification.rawValue, .displaySleep)
        observe(ws, NSWorkspace.willSleepNotification.rawValue, .systemSleep)
        observe(ws, NSWorkspace.sessionDidResignActiveNotification.rawValue, .userSwitch)
        registerPower()
        // the poll: edge-triggered, so a session that STAYS locked fires once
        (wasLocked, wasOffConsole) = Self.sessionState()
        wasDisplayAsleep = CGDisplayIsAsleep(CGMainDisplayID()) != 0
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        for (c, tok) in tokens { c.removeObserver(tok) }
        tokens.removeAll()
        if powerNotifier != 0 { IODeregisterForSystemPower(&powerNotifier) }
        if let p = powerPort { IONotificationPortDestroy(p) }
        if powerRoot != 0 { IOServiceClose(powerRoot) }
        powerPort = nil
        powerRoot = 0
        powerNotifier = 0
        fire = nil
    }

    private func observe(_ center: NotificationCenter, _ name: String, _ cause: SessionCause) {
        let tok = center.addObserver(forName: Notification.Name(name), object: nil, queue: nil) { [weak self] _ in self?.fire?(cause) }
        tokens.append((center, tok))
    }

    /// (screen locked, session not on the console) from the CGSession dictionary; (false, false) when there is none.
    private static func sessionState() -> (Bool, Bool) {
        guard let d = CGSessionCopyCurrentDictionary() as? [String: Any] else { return (false, false) }
        let locked = (d["CGSSessionScreenIsLocked"] as? Bool) ?? false
        let onConsole = (d[kCGSessionOnConsoleKey as String] as? Bool) ?? true
        return (locked, !onConsole)
    }

    private func poll() {
        let (locked, off) = Self.sessionState()
        let asleep = CGDisplayIsAsleep(CGMainDisplayID()) != 0
        if locked && !wasLocked { fire?(.screenLock) }
        if off && !wasOffConsole { fire?(.userSwitch) }
        if asleep && !wasDisplayAsleep { fire?(.displaySleep) }
        (wasLocked, wasOffConsole, wasDisplayAsleep) = (locked, off, asleep)
    }

    // IOKit messages (IOMessage.h: iokit_common_msg(0x270 / 0x280) = sys_iokit | value).
    private static let canSystemSleep: UInt32 = 0xE000_0270
    private static let systemWillSleep: UInt32 = 0xE000_0280

    private func registerPower() {
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        var port: IONotificationPortRef?
        let root = IORegisterForSystemPower(refcon, &port, { refcon, _, messageType, messageArgument in
            guard let refcon else { return }
            let me = Unmanaged<SystemSessionEvents>.fromOpaque(refcon).takeUnretainedValue()
            switch messageType {
            case SystemSessionEvents.systemWillSleep:
                me.fire?(.systemSleep) // invalidate first, then let the system sleep
                IOAllowPowerChange(me.powerRoot, Int(bitPattern: messageArgument))
            case SystemSessionEvents.canSystemSleep:
                IOAllowPowerChange(me.powerRoot, Int(bitPattern: messageArgument))
            default:
                break
            }
        }, &powerNotifier)
        guard root != 0, let p = port else { return } // the other sources still cover sleep
        powerRoot = root
        powerPort = p
        CFRunLoopAddSource(CFRunLoopGetMain(), IONotificationPortGetRunLoopSource(p).takeUnretainedValue(), .commonModes)
    }
}
