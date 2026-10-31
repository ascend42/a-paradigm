// gnomon-helper (darwin) 1.11.0 — the CALLER CHECK (TD-2026-10-29-746, spec G-HLP-03; S0 P1 PASS: stdio transport).
//
// The ops that need no presence (kernel.cert, anchor.*, click.*, presence.mode) are answered only to the signed
// kernel instance that spawned this helper:
//   1. stdin is the unix socket the kernel's libuv handed us; LOCAL_PEERTOKEN gives the peer's audit token;
//   2. the token's pid is our parent, and the parent has not changed since this helper started;
//   3. SecCodeCheckValidity(kSecCSStrictValidate) against the HARDCODED requirement below (identifier gnomon.kernel;
//      gnomon.kernel.dev only in a helper built with -DGNOMON_HELPER_DEV, never in a release helper);
//   4. hardened runtime, no get-task-allow, never ad-hoc, never gnomon.node;
//   5. the kernel's build stamp (the GNOMON_STAMP section postject puts in the signed SEA; covered by the signature,
//      read from the on-disk file whose cdhash equals the running process's) names a version >= minKernelVersion
//      and the profile its identifier implies.
// Root and approvals ops are unchanged: they are gated by presence, not by the caller.

import CryptoKit
import Darwin
import Foundation
import Security

let kernelReleaseIdentifier = "gnomon.kernel"
let kernelDevIdentifier = "gnomon.kernel.dev"
/// The Developer ID anchor + team every kernel requirement carries (never the identifier alone: ad-hoc never passes).
let kernelRequirementBase = "anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"SW4BMQ8PNL\""
func kernelRequirement(_ identifier: String) -> String { "\(kernelRequirementBase) and identifier \"\(identifier)\"" }

#if GNOMON_HELPER_DEV
let helperAcceptsDevKernel = true
#else
let helperAcceptsDevKernel = false
#endif

/// The oldest kernel this helper certifies (the first SEA kernel, 8.1.0 / S0).
let minKernelVersion = "8.1.0"
/// The SEA's build-stamp section (scripts/build-sea.mjs KERNEL_STAMP_*): segment __GNOMON, section GNOMON_STAMP.
let kernelStampSegment = "__GNOMON"
/// postject prefixes "__" to every Mach-O section name, so the resource GNOMON_STAMP lands as __GNOMON_STAMP
/// (fix 2026-10-31: 1.11.0-1.11.1 looked for GNOMON_STAMP, found no stamp and refused every release kernel).
let kernelStampSection = "__GNOMON_STAMP"
let kernelStampPrefix = "gnomon-kernel-stamp:v1\n"

struct KernelStamp: Equatable {
    let profile: String
    let version: String
}

/// What the caller check measured (production: SystemCallerProbe; tests: literal facts).
struct CallerFacts {
    var stdinIsSocket = true
    var tokenPid: Int32 = 0
    var pidVersion: Int32 = 0
    var parentPid: Int32 = 0
    var startParentPid: Int32 = 0
    /// The identifier whose full requirement the running code passed (strict); nil = neither.
    var matchedIdentifier: String?
    var signedIdentifier: String?
    var adhoc = false
    var hardenedRuntime = true
    var getTaskAllow = false
    var cdhash = ""
    var stamp: KernelStamp?
    var startedAt: Date?
}

/// The verified kernel instance (bound by pid + pidversion from its audit token).
struct Caller: Equatable {
    let pid: Int32
    let pidVersion: Int32
    let identifier: String
    let cdhash: String
    let version: String
    let startedAt: Date
}

func versionAtLeast(_ v: String, _ floor: String) -> Bool {
    func parts(_ s: String) -> [Int]? {
        let core = s.split(separator: "-", maxSplits: 1).first.map(String.init) ?? ""
        let p = core.split(separator: ".").map { Int($0) }
        guard p.count == 3, p.allSatisfy({ $0 != nil && $0! >= 0 }) else { return nil }
        return p.map { $0! }
    }
    guard let a = parts(v), let b = parts(floor) else { return false }
    return a.lexicographicallyPrecedes(b) == false
}

/// THE rule (pure; XCTest drives it with facts). nil = this is the kernel; else the refusal.
func callerRefusal(_ f: CallerFacts, acceptDev: Bool) -> HelperError? {
    func no(_ why: String) -> HelperError { HelperError("caller-refused", why) }
    guard f.stdinIsSocket else { return no("stdin is not the kernel's socket") }
    guard f.tokenPid > 0, f.tokenPid == f.parentPid else { return no("the peer is not this helper's parent") }
    guard f.parentPid == f.startParentPid, f.parentPid != 1 else { return no("the parent changed since the helper started") }
    if let s = f.signedIdentifier, s == "gnomon.node" || s.hasPrefix("gnomon.node.") { return no("a gnomon.node child is never the kernel") }
    guard !f.adhoc else { return no("an ad-hoc kernel is never certified") }
    guard let id = f.matchedIdentifier else { return no("the peer does not pass the kernel requirement") }
    guard id == kernelReleaseIdentifier || (id == kernelDevIdentifier && acceptDev) else { return no("a dev kernel is refused by a release helper") }
    guard f.hardenedRuntime else { return no("the kernel runs without the hardened runtime") }
    guard !f.getTaskAllow else { return no("the kernel carries get-task-allow") }
    guard let st = f.stamp else { return no("the kernel carries no build stamp") }
    guard st.profile == (id == kernelReleaseIdentifier ? "release" : "dev") else { return no("the kernel's stamp names another profile") }
    guard versionAtLeast(st.version, minKernelVersion) else { return HelperError("caller-refused", "kernel \(String(st.version.prefix(32))) is older than \(minKernelVersion)") }
    guard f.cdhash.count == 40, f.startedAt != nil else { return no("the kernel's cdhash or start time is unknown") }
    return nil
}

protocol CallerProbe {
    func facts() -> CallerFacts
}

/// Verifies once per helper process (the peer of a socketpair never changes); every call re-checks the parent.
final class CallerGate {
    private let probe: CallerProbe
    private let acceptDev: Bool
    private var verified: Caller?
    private let lock = NSLock()

    init(probe: CallerProbe, acceptDev: Bool = helperAcceptsDevKernel) {
        self.probe = probe
        self.acceptDev = acceptDev
    }

    func require() throws -> Caller {
        lock.lock()
        defer { lock.unlock() }
        let f = probe.facts()
        if let e = callerRefusal(f, acceptDev: acceptDev) {
            verified = nil
            throw e
        }
        let c = Caller(pid: f.tokenPid, pidVersion: f.pidVersion, identifier: f.matchedIdentifier!, cdhash: f.cdhash, version: f.stamp!.version, startedAt: f.startedAt!)
        // the audit-token instance is fixed for the helper's life: a different pid/pidversion is never accepted after the first
        if let v = verified, v != c { throw HelperError("caller-refused", "another process instance than the verified kernel") }
        verified = c
        return c
    }
}

// MARK: production probe

/// SOL_LOCAL = 0, LOCAL_PEERTOKEN = 0x006 (sys/un.h).
func peerAuditToken(_ fd: Int32) -> audit_token_t? {
    var tok = audit_token_t()
    var len = socklen_t(MemoryLayout<audit_token_t>.size)
    return getsockopt(fd, 0, 0x006, &tok, &len) == 0 ? tok : nil
}

func processStart(_ pid: Int32) -> Date? {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    guard sysctl(&mib, 4, &info, &size, nil, 0) == 0, size > 0 else { return nil }
    let tv = info.kp_proc.p_un.__p_starttime
    return Date(timeIntervalSince1970: TimeInterval(tv.tv_sec) + TimeInterval(tv.tv_usec) / 1_000_000)
}

/// The boot session UUID (kern.bootsessionuuid): a new value every boot.
func bootSessionId() -> String {
    var size = 0
    guard sysctlbyname("kern.bootsessionuuid", nil, &size, nil, 0) == 0, size > 0, size < 128 else { return "" }
    var buf = [CChar](repeating: 0, count: size)
    guard sysctlbyname("kern.bootsessionuuid", &buf, &size, nil, 0) == 0 else { return "" }
    return String(cString: buf)
}

private func readAt(_ h: FileHandle, _ off: UInt64, _ n: Int) -> Data? {
    guard n >= 0, n <= 1 << 20, (try? h.seek(toOffset: off)) != nil, let d = try? h.read(upToCount: n), d.count == n else { return nil }
    return d
}

private func u32(_ d: Data, _ o: Int, big: Bool = false) -> UInt32 {
    let v = d.subdata(in: d.startIndex + o..<d.startIndex + o + 4).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
    return big ? UInt32(bigEndian: v) : UInt32(littleEndian: v)
}

private func u64(_ d: Data, _ o: Int) -> UInt64 {
    UInt64(littleEndian: d.subdata(in: d.startIndex + o..<d.startIndex + o + 8).withUnsafeBytes { $0.loadUnaligned(as: UInt64.self) })
}

private func name16(_ d: Data, _ o: Int) -> String {
    String(decoding: d.subdata(in: d.startIndex + o..<d.startIndex + o + 16).prefix { $0 != 0 }, as: UTF8.self)
}

/// The GNOMON_STAMP section of a Mach-O (thin arm64/x86_64 or fat), parsed: `gnomon-kernel-stamp:v1\n{"profile","version"}`.
func readKernelStamp(path: String) -> KernelStamp? {
    guard let h = FileHandle(forReadingAtPath: path) else { return nil }
    defer { try? h.close() }
    return readKernelStamp(handle: h)
}

/// The identity of an open file or a path (dev, ino, size, mtime, ctime): equal before and after = the same bytes.
func fileIdentity(fd: Int32) -> [Int64]? {
    var st = stat()
    guard fstat(fd, &st) == 0 else { return nil }
    return [Int64(st.st_dev), Int64(st.st_ino), Int64(st.st_size), Int64(st.st_mtimespec.tv_sec), Int64(st.st_mtimespec.tv_nsec), Int64(st.st_ctimespec.tv_sec), Int64(st.st_ctimespec.tv_nsec)]
}

func fileIdentity(path: String) -> [Int64]? {
    var st = stat()
    guard stat(path, &st) == 0 else { return nil }
    return [Int64(st.st_dev), Int64(st.st_ino), Int64(st.st_size), Int64(st.st_mtimespec.tv_sec), Int64(st.st_mtimespec.tv_nsec), Int64(st.st_ctimespec.tv_sec), Int64(st.st_ctimespec.tv_nsec)]
}

func readKernelStamp(handle h: FileHandle) -> KernelStamp? {
    guard let magic = readAt(h, 0, 8) else { return nil }
    var base: UInt64 = 0
    if u32(magic, 0, big: true) == 0xCAFE_BABE { // FAT_MAGIC (big-endian), 32-bit fat_arch entries
        let n = Int(u32(magic, 4, big: true))
        guard n > 0, n <= 8, let archs = readAt(h, 8, n * 20) else { return nil }
        var want: UInt32 = 0x0100_000C // CPU_TYPE_ARM64
        #if arch(x86_64)
        want = 0x0100_0007
        #endif
        guard let i = (0..<n).first(where: { u32(archs, $0 * 20, big: true) == want }) else { return nil }
        base = UInt64(u32(archs, i * 20 + 8, big: true))
    }
    guard let hdr = readAt(h, base, 32), u32(hdr, 0) == 0xFEED_FACF else { return nil } // MH_MAGIC_64
    let ncmds = Int(u32(hdr, 16)), sizeofcmds = Int(u32(hdr, 20))
    guard ncmds <= 512, let cmds = readAt(h, base + 32, sizeofcmds) else { return nil }
    var o = 0
    for _ in 0..<ncmds {
        guard o + 8 <= cmds.count else { return nil }
        let cmd = u32(cmds, o), size = Int(u32(cmds, o + 4))
        guard size >= 8, o + size <= cmds.count else { return nil }
        if cmd == 0x19, size >= 72, name16(cmds, o + 8) == kernelStampSegment { // LC_SEGMENT_64
            let nsects = Int(u32(cmds, o + 64))
            for s in 0..<nsects {
                let so = o + 72 + s * 80
                guard so + 80 <= o + size else { return nil }
                guard name16(cmds, so) == kernelStampSection else { continue }
                let ssize = u64(cmds, so + 40), soff = u32(cmds, so + 48)
                guard ssize > 0, ssize <= 4096, let body = readAt(h, base + UInt64(soff), Int(ssize)) else { return nil }
                return parseKernelStamp(body)
            }
        }
        o += size
    }
    return nil
}

func parseKernelStamp(_ body: Data) -> KernelStamp? {
    let p = Data(kernelStampPrefix.utf8)
    let trimmed = body.prefix { $0 != 0 }
    guard trimmed.starts(with: p), let obj = (try? JSONSerialization.jsonObject(with: trimmed.dropFirst(p.count))) as? Json,
          let profile = obj["profile"] as? String, profile == "dev" || profile == "release",
          let version = obj["version"] as? String, version.count <= 32 else { return nil }
    return KernelStamp(profile: profile, version: version)
}

func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

final class SystemCallerProbe: CallerProbe {
    let startParentPid = getppid()

    func facts() -> CallerFacts {
        var f = CallerFacts()
        f.startParentPid = startParentPid
        f.parentPid = getppid()
        var st = stat()
        f.stdinIsSocket = fstat(0, &st) == 0 && (st.st_mode & S_IFMT) == S_IFSOCK
        guard f.stdinIsSocket, var tok = peerAuditToken(0) else { f.stdinIsSocket = false; return f }
        f.tokenPid = Int32(bitPattern: tok.val.5)
        f.pidVersion = Int32(bitPattern: tok.val.7)
        let tokData = withUnsafeBytes(of: &tok) { Data($0) }
        var code: SecCode?
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributeAudit: tokData] as CFDictionary, [], &code) == errSecSuccess, let c = code else { return f }
        let strict = SecCSFlags(rawValue: kSecCSStrictValidate)
        for id in [kernelReleaseIdentifier, kernelDevIdentifier] {
            var req: SecRequirement?
            guard SecRequirementCreateWithString(kernelRequirement(id) as CFString, [], &req) == errSecSuccess, let r = req else { continue }
            if SecCodeCheckValidity(c, strict, r) == errSecSuccess { f.matchedIdentifier = id; break }
        }
        var info: CFDictionary?
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation | kSecCSDynamicInformation | kSecCSRequirementInformation)
        guard SecCodeCopySigningInformation(unsafeBitCast(c, to: SecStaticCode.self), flags, &info) == errSecSuccess, let d = info as? Json else { return f }
        f.signedIdentifier = d[kSecCodeInfoIdentifier as String] as? String
        let sigFlags = (d[kSecCodeInfoFlags as String] as? NSNumber)?.uint32Value ?? 0
        f.adhoc = sigFlags & 0x2 != 0                  // kSecCodeSignatureAdhoc
        f.hardenedRuntime = sigFlags & 0x10000 != 0    // kSecCodeSignatureRuntime
        let ents = d[kSecCodeInfoEntitlementsDict as String] as? Json ?? [:]
        f.getTaskAllow = (ents["com.apple.security.get-task-allow"] as? Bool) == true
        let unique = d[kSecCodeInfoUnique as String] as? Data ?? Data()
        f.cdhash = hex(unique)
        f.startedAt = processStart(f.tokenPid)
        // the stamp (Aegis S1 L1): ONE open of the file; the stamp is read from that descriptor, then the path is
        // validated strictly (all pages, so the GNOMON_STAMP section too) with the running code's cdhash, and the path
        // must still name the very file that was read (same dev, inode, size, mtime, ctime) — never a re-opened copy
        var url: CFURL?
        if SecCodeCopyPath(unsafeBitCast(c, to: SecStaticCode.self), [], &url) == errSecSuccess, let u = url as URL?,
           let h = FileHandle(forReadingAtPath: u.path) {
            defer { try? h.close() }
            let before = fileIdentity(fd: h.fileDescriptor)
            let stamp = readKernelStamp(handle: h)
            var sc: SecStaticCode?
            if before != nil, SecStaticCodeCreateWithPath(u as CFURL, [], &sc) == errSecSuccess, let s = sc,
               SecStaticCodeCheckValidity(s, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures), nil) == errSecSuccess {
                var sinfo: CFDictionary?
                if SecCodeCopySigningInformation(s, SecCSFlags(rawValue: kSecCSSigningInformation), &sinfo) == errSecSuccess,
                   let sd = sinfo as? Json, (sd[kSecCodeInfoUnique as String] as? Data) == unique, !unique.isEmpty,
                   fileIdentity(path: u.path) == before, fileIdentity(fd: h.fileDescriptor) == before {
                    f.stamp = stamp
                }
            }
        }
        return f
    }
}
